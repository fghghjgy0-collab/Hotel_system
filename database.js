import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'hotel.db');

// Initialize database connection
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('journal_mode = WAL');

/**
 * Initialize database schema and seed initial data
 */
export function initializeDatabase() {
  try {
    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS hotel_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL CHECK(price > 0),
        category TEXT NOT NULL,
        description TEXT,
        image_emoji TEXT DEFAULT '🍽️',
        image_url TEXT,
        available INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'preparing', 'served', 'paid')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        payment_requested_at DATETIME,
        paid_at DATETIME,
        FOREIGN KEY (table_id) REFERENCES hotel_tables(id)
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price REAL NOT NULL CHECK(unit_price >= 0),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      );

      CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
    `);

    runMigrations();

    // Check if tables are already seeded
    const tableCount = db.prepare('SELECT COUNT(*) as count FROM hotel_tables').get().count;
    
    if (tableCount === 0) {
      seedDatabase();
    }

    console.log('✅ Database initialized successfully at:', DB_PATH);
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

function addColumnIfMissing(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some(column => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function runMigrations() {
  addColumnIfMissing('menu_items', 'image_url', 'TEXT');
  addColumnIfMissing('orders', 'payment_requested_at', 'DATETIME');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_payment_requested ON orders(payment_requested_at)');
}

/**
 * Seed database with initial tables and menu items
 */
function seedDatabase() {
  try {
    const insertTable = db.prepare('INSERT INTO hotel_tables (name) VALUES (?)');
    const insertMenuItem = db.prepare(
      'INSERT INTO menu_items (name, price, category, description, image_emoji) VALUES (?, ?, ?, ?, ?)'
    );

    // Begin transaction
    const transaction = db.transaction(() => {
      // Seed 5 tables
      for (let i = 1; i <= 5; i++) {
        insertTable.run(`Table ${i}`);
      }

      // Seed 15 Nepali menu items across categories
      const menuItems = [
        // Breakfast (नास्ता)
        { name: 'Nepali Chiya (Tea)', price: 40, category: 'Breakfast', description: 'Traditional milk tea', emoji: '☕' },
        { name: 'Sel Roti', price: 80, category: 'Breakfast', description: 'Sweet rice flour bread', emoji: '🍪' },
        { name: 'Yomari', price: 60, category: 'Breakfast', description: 'Steamed rice cake with jaggery', emoji: '🥟' },

        // Main Course (मुख्य खाना)
        { name: 'Dal Bhat', price: 280, category: 'Main Course', description: 'Rice with lentil soup', emoji: '🍚' },
        { name: 'Momo', price: 200, category: 'Main Course', description: 'Steamed dumplings (6 pieces)', emoji: '🥟' },
        { name: 'Chow Mein', price: 240, category: 'Main Course', description: 'Nepali fried noodles', emoji: '🍜' },
        { name: 'Thukpa', price: 220, category: 'Main Course', description: 'Noodle soup with meat', emoji: '🍲' },

        // Snacks (खाजा)
        { name: 'Samosa', price: 120, category: 'Snacks', description: 'Fried potato pastry (3 pieces)', emoji: '🥟' },
        { name: 'Pakora', price: 100, category: 'Snacks', description: 'Fried vegetable fritters', emoji: '🍖' },
        { name: 'Aloo Tikki', price: 80, category: 'Snacks', description: 'Potato patty', emoji: '🥔' },

        // Beverages (पेय)
        { name: 'Lassi', price: 120, category: 'Beverages', description: 'Yogurt drink', emoji: '🥛' },
        { name: 'Masala Tea', price: 50, category: 'Beverages', description: 'Spiced tea', emoji: '☕' },
        { name: 'Mango Juice', price: 150, category: 'Beverages', description: 'Fresh mango juice', emoji: '🥭' },

        // Desserts (मिठाइ)
        { name: 'Gulab Jamun', price: 140, category: 'Desserts', description: 'Sweet milk solids in syrup', emoji: '🍮' },
        { name: 'Khir', price: 120, category: 'Desserts', description: 'Rice pudding', emoji: '🍚' },
      ];

      menuItems.forEach(item => {
        insertMenuItem.run(item.name, item.price, item.category, item.description, item.emoji);
      });
    });

    transaction();
    console.log('✅ Database seeded with 5 tables and 15 menu items');
  } catch (error) {
    console.error('❌ Database seeding error:', error);
    throw error;
  }
}

/**
 * Get database instance for use in other modules
 */
export function getDatabase() {
  return db;
}

/**
 * Get all tables with pending order count
 */
export function getTablesWithOrderCount() {
  const query = `
    SELECT 
      t.id,
      t.name,
      t.is_active,
      COUNT(CASE WHEN o.status IN ('pending', 'preparing') THEN 1 END) as pending_orders,
      COUNT(CASE WHEN o.payment_requested_at IS NOT NULL AND o.status != 'paid' THEN 1 END) as payment_requests,
      MAX(o.created_at) as last_order_time
    FROM hotel_tables t
    LEFT JOIN orders o ON t.id = o.table_id
    WHERE t.is_active = 1
    GROUP BY t.id
    ORDER BY t.name
  `;
  return db.prepare(query).all();
}

/**
 * Get table by ID with order count
 */
export function getTableWithOrderCount(tableId) {
  const query = `
    SELECT 
      t.id,
      t.name,
      t.is_active,
      COUNT(CASE WHEN o.status IN ('pending', 'preparing') THEN 1 END) as pending_orders,
      COUNT(CASE WHEN o.payment_requested_at IS NOT NULL AND o.status != 'paid' THEN 1 END) as payment_requests
    FROM hotel_tables t
    LEFT JOIN orders o ON t.id = o.table_id
    WHERE t.id = ?
    GROUP BY t.id
  `;
  return db.prepare(query).get(tableId);
}

/**
 * Get menu items grouped by category
 */
export function getMenuByCategory() {
  const items = db.prepare(`
    SELECT * FROM menu_items 
    WHERE available = 1
    ORDER BY category, name
  `).all();

  // Group by category
  const grouped = {};
  items.forEach(item => {
    if (!grouped[item.category]) {
      grouped[item.category] = [];
    }
    grouped[item.category].push(item);
  });

  return grouped;
}

/**
 * Get order with items
 */
export function getOrderWithItems(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;

  const items = db.prepare(`
    SELECT 
      oi.*,
      m.name as menu_name,
      m.image_emoji,
      m.image_url
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE oi.order_id = ?
  `).all(orderId);

  return { ...order, items };
}

/**
 * Get all unpaid orders for a table
 */
export function getTableOrders(tableId) {
  const orders = db.prepare(`
    SELECT * FROM orders 
    WHERE table_id = ? AND status != 'paid'
    ORDER BY created_at DESC
  `).all(tableId);

  return orders.map(order => ({
    ...order,
    items: db.prepare(`
      SELECT 
        oi.*,
        m.name as menu_name,
        m.image_emoji,
        m.image_url
      FROM order_items oi
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE oi.order_id = ?
    `).all(order.id)
  }));
}

/**
 * Calculate bill summary with VAT
 */
export function calculateBillSummary(tableId) {
  const orders = getTableOrders(tableId);

  const grouped = new Map();

  orders.forEach(order => {
    order.items.forEach(item => {
      const key = `${item.menu_item_id}:${item.unit_price}:${order.status}`;
      const existing = grouped.get(key) || {
        menu_item_id: item.menu_item_id,
        name: item.menu_name,
        quantity: 0,
        unit_price: item.unit_price,
        line_total: 0,
        subtotal: 0,
        status: order.status,
        notes: [],
        emoji: item.image_emoji,
        image_url: item.image_url,
        order_ids: [],
        payment_requested_at: order.payment_requested_at
      };

      existing.quantity += item.quantity;
      existing.line_total += item.quantity * item.unit_price;
      existing.subtotal = existing.line_total;
      if (item.notes) existing.notes.push(item.notes);
      if (!existing.order_ids.includes(order.id)) existing.order_ids.push(order.id);
      if (!existing.payment_requested_at && order.payment_requested_at) {
        existing.payment_requested_at = order.payment_requested_at;
      }
      grouped.set(key, existing);
    });
  });

  const items = Array.from(grouped.values()).map(item => ({
    ...item,
    line_total: Math.round(item.line_total * 100) / 100,
    subtotal: Math.round(item.subtotal * 100) / 100,
    notes: item.notes.join('; ')
  }));
  const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
  const vat = subtotal * 0.13;
  const total = subtotal + vat;

  return {
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    total: Math.round(total * 100) / 100,
    payment_requested: orders.some(order => Boolean(order.payment_requested_at)),
    payment_requested_at: orders.find(order => order.payment_requested_at)?.payment_requested_at || null
  };
}

export function getPendingPaymentRequests() {
  const rows = db.prepare(`
    SELECT
      o.table_id,
      t.name as table_name,
      MIN(o.payment_requested_at) as requested_at,
      COUNT(o.id) as order_count
    FROM orders o
    JOIN hotel_tables t ON t.id = o.table_id
    WHERE o.payment_requested_at IS NOT NULL AND o.status != 'paid'
    GROUP BY o.table_id, t.name
    ORDER BY requested_at ASC
  `).all();

  return rows.map(row => ({
    ...row,
    bill: calculateBillSummary(row.table_id)
  }));
}

export default db;
