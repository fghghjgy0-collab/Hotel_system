import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, getMenuByCategory } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { emitAll } from '../socket.js';

const router = express.Router();
const db = getDatabase();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'menu');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    }
  }),
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Dish photo must be an image file'));
      return;
    }
    cb(null, true);
  }
});

function handleMenuPhotoUpload(req, res, next) {
  upload.single('image_file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Dish photo must be 2 MB or smaller' });
    }

    return res.status(400).json({ error: error.message || 'Invalid dish photo upload' });
  });
}

function parsePositiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parsePositivePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeImageUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return '';
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('/uploads/menu/')) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (['http:', 'https:'].includes(url.protocol)) {
      return url.toString();
    }
  } catch (error) {
    return '';
  }

  return '';
}

function getUploadedImageUrl(file) {
  return file ? `/uploads/menu/${file.filename}` : '';
}

/**
 * GET /api/menu
 * Get all available menu items grouped by category
 * Public endpoint
 * Returns: { Breakfast: [...], MainCourse: [...], ... }
 */
router.get('/', (req, res) => {
  try {
    const menu = getMenuByCategory();
    res.json({ success: true, data: menu });
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

/**
 * GET /api/menu/:id
 * Get single menu item
 * Public endpoint
 */
router.get('/:id', (req, res) => {
  try {
    const itemId = parsePositiveId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ error: 'Invalid menu item ID' });
    }

    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Get menu item error:', error);
    res.status(500).json({ error: 'Failed to fetch menu item' });
  }
});

/**
 * POST /api/menu
 * Create new menu item
 * Admin only
 * Body: { name, price, category, description, image_emoji }
 */
router.post('/', requireAuth(['admin']), handleMenuPhotoUpload, (req, res) => {
  try {
    const { name, price, category, description, image_emoji, image_url } = req.body;

    // Validate required fields
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanCategory = typeof category === 'string' ? category.trim() : '';
    const cleanDescription = typeof description === 'string' ? description.trim() : '';
    const cleanEmoji = typeof image_emoji === 'string' && image_emoji.trim() ? image_emoji.trim() : '🍽️';
    const cleanImageUrl = getUploadedImageUrl(req.file) || normalizeImageUrl(image_url);
    const cleanPrice = parsePositivePrice(price);

    if (!cleanName || !cleanPrice || !cleanCategory) {
      return res.status(400).json({ error: 'Name, price, and category are required' });
    }

    const result = db.prepare(`
      INSERT INTO menu_items (name, price, category, description, image_emoji, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(cleanName, cleanPrice, cleanCategory, cleanDescription, cleanEmoji, cleanImageUrl);

    const newItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);

    // Emit update event to all clients
    const menu = getMenuByCategory();
    emitAll('menu_updated', { menu });

    res.status(201).json({
      success: true,
      message: 'Menu item created',
      data: newItem
    });
  } catch (error) {
    console.error('Create menu item error:', error);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
});

/**
 * PUT /api/menu/:id
 * Update menu item
 * Admin only
 * Body: { name?, price?, category?, description?, image_emoji?, available? }
 */
router.put('/:id', requireAuth(['admin']), handleMenuPhotoUpload, (req, res) => {
  try {
    const itemId = parsePositiveId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ error: 'Invalid menu item ID' });
    }

    const { name, price, category, description, image_emoji, image_url, available } = req.body;

    // Check item exists
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    // Validate price if provided
    const cleanPrice = price !== undefined ? parsePositivePrice(price) : undefined;
    if (price !== undefined && !cleanPrice) {
      return res.status(400).json({ error: 'Price must be a positive number' });
    }

    // Build update query
    const updates = [];
    const values = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (price !== undefined) {
      updates.push('price = ?');
      values.push(cleanPrice);
    }
    if (category !== undefined) {
      if (typeof category !== 'string' || category.trim() === '') {
        return res.status(400).json({ error: 'Category cannot be empty' });
      }
      updates.push('category = ?');
      values.push(category.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(typeof description === 'string' ? description.trim() : '');
    }
    if (image_emoji !== undefined) {
      updates.push('image_emoji = ?');
      values.push(typeof image_emoji === 'string' && image_emoji.trim() ? image_emoji.trim() : '🍽️');
    }
    if (req.file || image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(getUploadedImageUrl(req.file) || normalizeImageUrl(image_url));
    }
    if (available !== undefined) {
      updates.push('available = ?');
      values.push(available ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(itemId);
    const query = `UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    const updatedItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId);

    // Emit update event
    const menu = getMenuByCategory();
    emitAll('menu_updated', { menu });

    res.json({
      success: true,
      message: 'Menu item updated',
      data: updatedItem
    });
  } catch (error) {
    console.error('Update menu item error:', error);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

/**
 * DELETE /api/menu/:id
 * Delete or disable menu item
 * Admin only
 * Hard delete if no orders, otherwise set available = 0
 */
router.delete('/:id', requireAuth(['admin']), (req, res) => {
  try {
    const itemId = parsePositiveId(req.params.id);
    if (!itemId) {
      return res.status(400).json({ error: 'Invalid menu item ID' });
    }

    const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    // Check if item is in any active orders
    const inOrders = db.prepare(
      'SELECT COUNT(*) as count FROM order_items WHERE menu_item_id = ?'
    ).get(itemId);

    if (inOrders.count > 0) {
      // Just disable it
      db.prepare('UPDATE menu_items SET available = 0 WHERE id = ?').run(itemId);
    } else {
      // Hard delete
      db.prepare('DELETE FROM menu_items WHERE id = ?').run(itemId);
    }

    // Emit update event
    const menu = getMenuByCategory();
    emitAll('menu_updated', { menu });

    res.json({
      success: true,
      message: inOrders.count > 0 ? 'Item disabled (used in orders)' : 'Item deleted'
    });
  } catch (error) {
    console.error('Delete menu item error:', error);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

export default router;
