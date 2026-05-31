import express from 'express';
import { getDatabase } from '../database.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const db = getDatabase();

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * GET /api/analytics/summary
 * Admin-only hotel analytics summary
 */
router.get('/summary', requireAuth(['admin']), (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const todayRevenue = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity * oi.unit_price * 1.13), 0) as revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'paid' AND DATE(o.paid_at) = DATE(?)
    `).get(today).revenue;

    const todayOrders = db.prepare(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE status = 'paid' AND DATE(paid_at) = DATE(?)
    `).get(today).count;

    const weeklyRows = db.prepare(`
      SELECT DATE(paid_at) as date, COALESCE(SUM(oi.quantity * oi.unit_price * 1.13), 0) as revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'paid' AND DATE(o.paid_at) >= DATE(?, '-6 days')
      GROUP BY DATE(o.paid_at)
    `).all(today);
    const weeklyByDate = new Map(weeklyRows.map(row => [row.date, roundMoney(row.revenue)]));
    const weeklyRevenue = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${today}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return { date: key, revenue: weeklyByDate.get(key) || 0 };
    });

    const topItems = db.prepare(`
      SELECT m.name, m.image_emoji as emoji, SUM(oi.quantity) as quantity
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN menu_items m ON m.id = oi.menu_item_id
      WHERE o.status = 'paid'
      GROUP BY m.id
      ORDER BY quantity DESC
      LIMIT 5
    `).all();

    const tableUtilization = db.prepare(`
      SELECT
        t.id,
        t.name,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(oi.quantity * oi.unit_price * 1.13), 0) as revenue
      FROM hotel_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'paid' AND DATE(o.paid_at) = DATE(?)
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE t.is_active = 1
      GROUP BY t.id
      ORDER BY revenue DESC
    `).all(today).map(row => ({ ...row, revenue: roundMoney(row.revenue) }));

    const pendingCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE status IN ('pending', 'preparing')
    `).get().count;

    const hourlyRows = db.prepare(`
      SELECT CAST(strftime('%H', paid_at) AS INTEGER) as hour, COUNT(*) as orders
      FROM orders
      WHERE status = 'paid' AND DATE(paid_at) = DATE(?)
      GROUP BY hour
    `).all(today);
    const hourlyByHour = new Map(hourlyRows.map(row => [row.hour, row.orders]));
    const hourlyBreakdown = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: hourlyByHour.get(hour) || 0
    }));

    res.json({
      success: true,
      data: {
        today_revenue: roundMoney(todayRevenue),
        today_orders: todayOrders,
        weekly_revenue: weeklyRevenue,
        top_items: topItems,
        table_utilization: tableUtilization,
        avg_order_value: todayOrders ? roundMoney(todayRevenue / todayOrders) : 0,
        pending_count: pendingCount,
        hourly_breakdown: hourlyBreakdown
      }
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

export default router;
