import express from 'express';
import { getDatabase, getTablesWithOrderCount, getTableWithOrderCount } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { emitTo } from '../socket.js';

const router = express.Router();
const db = getDatabase();

function parsePositiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/tables
 * Get all active tables with pending order count
 * Public endpoint
 */
router.get('/', (req, res) => {
  try {
    const tables = getTablesWithOrderCount();
    res.json({ success: true, data: tables });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

/**
 * GET /api/tables/:id
 * Get single table with order count
 * Public endpoint
 */
router.get('/:id', (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.id);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const table = getTableWithOrderCount(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json({ success: true, data: table });
  } catch (error) {
    console.error('Get table error:', error);
    res.status(500).json({ error: 'Failed to fetch table' });
  }
});

/**
 * POST /api/tables
 * Create new table
 * Admin only
 * Body: { name }
 */
router.post('/', requireAuth(['admin']), (req, res) => {
  try {
    const { name } = req.body;

    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    // Check for duplicate names
    const existing = db.prepare('SELECT id FROM hotel_tables WHERE name = ?').get(cleanName);
    if (existing) {
      return res.status(400).json({ error: 'Table name already exists' });
    }

    // Insert new table
    const result = db.prepare('INSERT INTO hotel_tables (name) VALUES (?)').run(cleanName);
    const newTable = db.prepare('SELECT * FROM hotel_tables WHERE id = ?').get(result.lastInsertRowid);

    // Emit update event
    const allTables = getTablesWithOrderCount();
    emitTo('admin', 'tables_updated', { tables: allTables });

    res.status(201).json({
      success: true,
      message: 'Table created',
      data: newTable
    });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
});

/**
 * PUT /api/tables/:id
 * Update table (name or status)
 * Admin only
 * Body: { name?, is_active? }
 */
router.put('/:id', requireAuth(['admin']), (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.id);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const { name, is_active } = req.body;

    // Get current table
    const table = db.prepare('SELECT * FROM hotel_tables WHERE id = ?').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check if name already exists (if changing)
    const cleanName = typeof name === 'string' ? name.trim() : name;

    if (cleanName && cleanName !== table.name) {
      const existing = db.prepare('SELECT id FROM hotel_tables WHERE name = ?').get(cleanName);
      if (existing) {
        return res.status(400).json({ error: 'Table name already exists' });
      }
    }

    // Build update query
    const updates = [];
    const values = [];
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Table name cannot be empty' });
      }
      updates.push('name = ?');
      values.push(cleanName);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(tableId);
    const query = `UPDATE hotel_tables SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    const updatedTable = db.prepare('SELECT * FROM hotel_tables WHERE id = ?').get(tableId);

    // Emit update event
    const allTables = getTablesWithOrderCount();
    emitTo('admin', 'tables_updated', { tables: allTables });

    res.json({
      success: true,
      message: 'Table updated',
      data: updatedTable
    });
  } catch (error) {
    console.error('Update table error:', error);
    res.status(500).json({ error: 'Failed to update table' });
  }
});

/**
 * DELETE /api/tables/:id
 * Soft delete table (set is_active = 0)
 * Admin only
 * Blocks deletion if table has pending orders
 */
router.delete('/:id', requireAuth(['admin']), (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.id);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const table = db.prepare('SELECT id FROM hotel_tables WHERE id = ?').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check for pending orders
    const pendingOrders = db.prepare(
      'SELECT COUNT(*) as count FROM orders WHERE table_id = ? AND status IN (?, ?)'
    ).get(tableId, 'pending', 'preparing');

    if (pendingOrders.count > 0) {
      return res.status(400).json({
        error: 'Cannot delete table with pending orders',
        pending_orders: pendingOrders.count
      });
    }

    // Soft delete
    db.prepare('UPDATE hotel_tables SET is_active = 0 WHERE id = ?').run(tableId);

    // Emit update event
    const allTables = getTablesWithOrderCount();
    emitTo('admin', 'tables_updated', { tables: allTables });

    res.json({
      success: true,
      message: 'Table deleted'
    });
  } catch (error) {
    console.error('Delete table error:', error);
    res.status(500).json({ error: 'Failed to delete table' });
  }
});

export default router;
