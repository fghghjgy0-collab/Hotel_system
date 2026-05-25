import express from 'express';
import QRCode from 'qrcode';
import os from 'os';
import { config } from '../config.js';
import { getDatabase } from '../database.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const db = getDatabase();

function parsePositiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Get local IP address for QR code URLs
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

/**
 * GET /api/qr/generate
 * Generate QR codes for all active tables
 * Admin auth
 * Returns: { tables: [{ id, name, qrCode (base64 PNG) }] }
 */
router.get('/generate', requireAuth(['admin']), async (req, res) => {
  try {
    const localIP = getLocalIP();
    const port = config.port;

    // Get all active tables
    const tables = db.prepare('SELECT id, name FROM hotel_tables WHERE is_active = 1 ORDER BY name').all();

    if (tables.length === 0) {
      return res.json({ success: true, message: 'No active tables', data: [] });
    }

    // Generate QR codes for each table
    const qrCodes = await Promise.all(
      tables.map(async (table) => {
        const url = `http://${localIP}:${port}/table/index.html?table=${table.id}`;
        const qrCode = await QRCode.toDataURL(url, {
          width: 200,
          margin: 2,
          color: {
            dark: '#2C1810',
            light: '#FFF8F0'
          }
        });

        return {
          id: table.id,
          name: table.name,
          url,
          qrCode
        };
      })
    );

    res.json({
      success: true,
      message: `Generated ${qrCodes.length} QR codes`,
      data: qrCodes
    });
  } catch (error) {
    console.error('Generate QR codes error:', error);
    res.status(500).json({ error: 'Failed to generate QR codes' });
  }
});

/**
 * GET /api/qr/table/:id
 * Generate QR code for single table
 * Admin auth
 * Returns: { id, name, url, qrCode (base64 PNG) }
 */
router.get('/table/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const tableId = parsePositiveId(req.params.id);
    if (!tableId) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    // Get table
    const table = db.prepare('SELECT id, name FROM hotel_tables WHERE id = ?').get(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const localIP = getLocalIP();
    const port = config.port;
    const url = `http://${localIP}:${port}/table/index.html?table=${table.id}`;

    // Generate QR code
    const qrCode = await QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: {
        dark: '#2C1810',
        light: '#FFF8F0'
      }
    });

    res.json({
      success: true,
      data: {
        id: table.id,
        name: table.name,
        url,
        qrCode
      }
    });
  } catch (error) {
    console.error('Generate QR code error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

export default router;
