import express from 'express';
import { getDatabase, getOrderWithItems, getTableOrders, calculateBillSummary, getMenuByCategory } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { emitTo } from '../socket.js';
import { parseNaturalLanguageOrder, suggestMenuItems } from '../ai/claude.js';

const router = express.Router();
const db = getDatabase();

// Memory cache for suggestions (5 minute expiry)
const suggestionCache = new Map();

function parsePositiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 99 ? quantity : null;
}

/**
 * POST /api/orders
 * Create new order from cart
 * Public endpoint
 * Body: { table_id, items: [{menu_item_id, quantity, notes?}] }
 * Returns: { order_id, total }
 */
router.post('/', (req, res) => {
  try {
    const { table_id, items } = req.body;

    const tableId = parsePositiveId(table_id);
    if (!tableId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Table ID and items are required' });
    }

    // Validate table exists
    const table = db.prepare('SELECT id FROM hotel_tables WHERE id = ? AND is_active = 1').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Validate items exist and lock prices
    const validatedItems = [];
    for (const item of items) {
      const menuItemId = parsePositiveId(item?.menu_item_id);
      const quantity = parseQuantity(item?.quantity);
      if (!menuItemId || !quantity) {
        return res.status(400).json({ error: 'Each order item must include a valid menu item ID and quantity' });
      }

      const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1').get(menuItemId);
      if (!menuItem) {
        return res.status(400).json({ error: `Menu item ${menuItemId} not found or unavailable` });
      }
      validatedItems.push({
        menu_item_id: menuItemId,
        quantity,
        notes: typeof item.notes === 'string' ? item.notes.trim() : '',
        unit_price: menuItem.price
      });
    }

    // Use transaction for atomicity
    const transaction = db.transaction(() => {
      // Create order
      const orderResult = db.prepare(`
        INSERT INTO orders (table_id, status) VALUES (?, ?)
      `).run(tableId, 'pending');

      const orderId = orderResult.lastInsertRowid;

      // Insert order items
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, notes)
        VALUES (?, ?, ?, ?, ?)
      `);

      validatedItems.forEach(item => {
        insertItem.run(
          orderId,
          item.menu_item_id,
          item.quantity,
          item.unit_price,
          item.notes
        );
      });

      return orderId;
    });

    const orderId = transaction();
    // Calculate bill
    const tableBill = calculateBillSummary(tableId);

    // Emit events
    emitTo('receptionist', 'new_order', {
      order_id: orderId,
      table_id: tableId,
      item_count: validatedItems.length,
      created_at: new Date().toISOString()
    });

    emitTo(`table_${tableId}`, 'bill_updated', {
  items: tableBill.items,
  subtotal: tableBill.subtotal,
  vat: tableBill.vat,
  total: tableBill.total,
  payment_requested: tableBill.payment_requested
});

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: {
        order_id: orderId,
        table_id: tableId,
        item_count: validatedItems.length,
        subtotal: tableBill.subtotal,
        vat: tableBill.vat,
        total: tableBill.total
      }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * GET /api/orders/table/:tableId
 * Get all unpaid orders for a table
 * Public endpoint
 */
router.get('/table/:tableId', (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.tableId);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const orders = getTableOrders(tableId);
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Get table orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/orders/table/:tableId/bill-summary
 * Get itemized bill with VAT for a table
 * Public endpoint
 */
router.get('/table/:tableId/bill-summary', (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.tableId);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const bill = calculateBillSummary(tableId);
    res.json({ success: true, data: bill });
  } catch (error) {
    console.error('Get bill summary error:', error);
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
});

/**
 * POST /api/orders/table/:tableId/request-payment
 * Customer requests receptionist payment confirmation for all unpaid table orders
 */
router.post('/table/:tableId/request-payment', (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.tableId);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const table = db.prepare('SELECT id, name FROM hotel_tables WHERE id = ? AND is_active = 1').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const unpaidOrders = db.prepare(`
      SELECT id FROM orders
      WHERE table_id = ? AND status != 'paid'
    `).all(tableId);

    if (unpaidOrders.length === 0) {
      return res.status(400).json({ error: 'No unpaid orders found for this table' });
    }

    const requestedAt = new Date().toISOString();
    db.prepare(`
      UPDATE orders
      SET payment_requested_at = COALESCE(payment_requested_at, ?)
      WHERE table_id = ? AND status != 'paid'
    `).run(requestedAt, tableId);

    const bill = calculateBillSummary(tableId);

    emitTo('receptionist', 'payment_requested', {
      table_id: tableId,
      table_name: table.name,
      order_count: unpaidOrders.length,
      total: bill.total,
      requested_at: requestedAt
    });

    emitTo(`table_${tableId}`, 'payment_requested', {
      table_id: tableId,
      requested_at: requestedAt,
      total: bill.total
    });

    res.json({
      success: true,
      message: 'Payment request sent to receptionist',
      data: {
        table_id: tableId,
        order_count: unpaidOrders.length,
        total: bill.total,
        requested_at: requestedAt
      }
    });
  } catch (error) {
    console.error('Request payment error:', error);
    res.status(500).json({ error: 'Failed to request payment' });
  }
});

/**
 * POST /api/orders/table/:tableId/confirm-payment
 * Receptionist/Admin confirms payment and resets active table state
 */
router.post('/table/:tableId/confirm-payment', requireAuth(['receptionist', 'admin']), (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.tableId);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const table = db.prepare('SELECT id, name FROM hotel_tables WHERE id = ?').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const bill = calculateBillSummary(tableId);
    if (!bill.items.length) {
      return res.status(400).json({ error: 'No unpaid orders found for this table' });
    }

    const paidAt = new Date().toISOString();
    const result = db.prepare(`
      UPDATE orders
      SET status = 'paid', paid_at = ?, payment_requested_at = NULL
      WHERE table_id = ? AND status != 'paid'
    `).run(paidAt, tableId);

    emitTo('receptionist', 'payment_confirmed', {
      table_id: tableId,
      table_name: table.name,
      paid_at: paidAt,
      total: bill.total
    });

    emitTo(`table_${tableId}`, 'payment_confirmed', {
      table_id: tableId,
      paid_at: paidAt,
      total: bill.total
    });

    emitTo(`table_${tableId}`, 'bill_updated', {
  items: tableBill.items,
  subtotal: tableBill.subtotal,
  vat: tableBill.vat,
  total: tableBill.total,
  payment_requested: tableBill.payment_requested
});

    res.json({
      success: true,
      message: 'Payment confirmed and table reset',
      data: {
        table_id: tableId,
        orders_paid: result.changes,
        paid_at: paidAt,
        total: bill.total
      }
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

/**
 * GET /api/orders
 * Get all active orders (pending, preparing, served)
 * Receptionist/Admin auth
 * Query: ?status=pending|preparing|served
 */
router.get('/', requireAuth(['receptionist', 'admin']), (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        o.*,
        t.name as table_name,
        COUNT(oi.id) as item_count
      FROM orders o
      JOIN hotel_tables t ON o.table_id = t.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.status IN ('pending', 'preparing', 'served')
    `;

    const params = [];

    if (status) {
      if (!['pending', 'preparing', 'served'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      query += ` AND o.status = ?`;
      params.push(status);
    }

    query += ` GROUP BY o.id ORDER BY o.created_at DESC`;

    const orders = db.prepare(query).all(...params);

    // Add items to each order
    const ordersWithItems = orders.map(order => ({
      ...order,
      items: getOrderWithItems(order.id)?.items || []
    }));

    res.json({ success: true, data: ordersWithItems });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * PATCH /api/orders/:id/status
 * Update order status
 * Receptionist/Admin auth
 * Body: { status: 'preparing'|'served'|'paid' }
 */
router.patch('/:id/status', requireAuth(['receptionist', 'admin']), (req, res) => {
  try {
    const { status } = req.body;
    const orderId = parsePositiveId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    if (!['pending', 'preparing', 'served', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get order
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update status
    const updates = { status };
    if (status === 'paid') {
      updates.paid_at = new Date().toISOString();
    }

    db.prepare(`
      UPDATE orders SET status = ?, paid_at = ? WHERE id = ?
    `).run(status, updates.paid_at || null, orderId);

    const updatedOrder = getOrderWithItems(orderId);

    // Emit events
    emitTo('receptionist', 'order_status_update', {
      order_id: orderId,
      status,
      table_id: order.table_id
    });

    emitTo(`table_${order.table_id}`, 'order_status_update', {
      order_id: orderId,
      status
    });

    // Update bill if status changed
    if (status !== 'paid') {
      const bill = calculateBillSummary(order.table_id);
      emitTo(`table_${tableId}`, 'bill_updated', {
  items: tableBill.items,
  subtotal: tableBill.subtotal,
  vat: tableBill.vat,
  total: tableBill.total,
  payment_requested: tableBill.payment_requested
});
    }

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      data: updatedOrder
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

/**
 * POST /api/orders/natural-language
 * Create order from natural language input with AI parsing
 * Public endpoint
 * Body: { table_id, text: 'I want 2 momos and a tea' }
 * Returns: { parsed, unrecognized, order, message }
 */
router.post('/natural-language', async (req, res) => {
  try {
    const { table_id, text } = req.body;

    const tableId = parsePositiveId(table_id);
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!tableId || !cleanText) {
      return res.status(400).json({ error: 'Table ID and text are required' });
    }

    // Validate table exists
    const table = db.prepare('SELECT id FROM hotel_tables WHERE id = ? AND is_active = 1').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Get menu for parsing
    const menuGrouped = getMenuByCategory();
    const menu = Object.values(menuGrouped).flat();

    // Parse with AI
    const parsed = await parseNaturalLanguageOrder(cleanText, menu);

    if (!parsed) {
      return res.status(400).json({
        success: false,
        message: 'Could not parse your order. Please try again.',
        parsed: null,
        unrecognized: []
      });
    }

    // If no items found, return early
    if (!parsed.items || parsed.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No menu items recognized in your text.',
        parsed,
        unrecognized: parsed.unrecognized || []
      });
    }

    // Create order with parsed items
    const validatedItems = [];
    for (const item of parsed.items) {
      // Find exact match in menu
      const menuItem = menu.find(m => m.id === item.menu_item_id);
      if (menuItem) {
        validatedItems.push({
          menu_item_id: menuItem.id,
          quantity: parseQuantity(item.quantity) || 1,
          notes: `AI parsed: ${item.name}`,
          unit_price: menuItem.price
        });
      }
    }

    if (validatedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid menu items found in your order.',
        parsed,
        unrecognized: parsed.unrecognized || []
      });
    }

    // Create order
    const transaction = db.transaction(() => {
      const orderResult = db.prepare(`
        INSERT INTO orders (table_id, status) VALUES (?, ?)
      `).run(tableId, 'pending');

      const orderId = orderResult.lastInsertRowid;
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, notes)
        VALUES (?, ?, ?, ?, ?)
      `);

      validatedItems.forEach(item => {
        insertItem.run(
          orderId,
          item.menu_item_id,
          item.quantity,
          item.unit_price,
          item.notes
        );
      });

      return orderId;
    });

    const orderId = transaction();
    const tableBill = calculateBillSummary(tableId);

    // Emit events
    emitTo('receptionist', 'new_order', {
      order_id: orderId,
      table_id: tableId,
      item_count: validatedItems.length,
      created_at: new Date().toISOString()
    });

    emitTo(`table_${tableId}`, 'bill_updated', {
  items: tableBill.items,
  subtotal: tableBill.subtotal,
  vat: tableBill.vat,
  total: tableBill.total,
  payment_requested: tableBill.payment_requested
});

    res.status(201).json({
      success: true,
      message: `✅ Order created from AI parsing!`,
      parsed: {
        recognized: validatedItems.map(i => ({
          name: menu.find(m => m.id === i.menu_item_id)?.name,
          quantity: i.quantity
        })),
        unrecognized: parsed.unrecognized || []
      },
      order: {
        order_id: orderId,
        item_count: validatedItems.length,
        total: tableBill.total
      }
    });
  } catch (error) {
    console.error('Natural language order error:', error);
    res.status(500).json({ error: 'Failed to process natural language order' });
  }
});

/**
 * GET /api/orders/table/:tableId/suggestions
 * Get AI-suggested menu items based on current order
 * Public endpoint with memory caching (5 min)
 */
router.get('/table/:tableId/suggestions', async (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.tableId);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const cacheKey = `suggestions_${tableId}`;
    
    // Check cache
    if (suggestionCache.has(cacheKey)) {
      const cached = suggestionCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return res.json({ success: true, data: cached.data, fromCache: true });
      }
    }

    // Get current order items for context
    const orders = getTableOrders(tableId);
    const currentItems = [];
    orders.forEach(order => {
      order.items.forEach(item => {
        currentItems.push({ name: item.menu_name });
      });
    });

    // Get menu
    const menuGrouped = getMenuByCategory();
    const menu = Object.values(menuGrouped).flat();

    // Get suggestions from AI
    const suggestions = await suggestMenuItems(currentItems, menu) || { suggestions: [] };

    // Cache result
    suggestionCache.set(cacheKey, {
      timestamp: Date.now(),
      data: suggestions
    });

    res.json({ success: true, data: suggestions });
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ error: 'Failed to get suggestions', data: [] });
  }
});

export default router;
