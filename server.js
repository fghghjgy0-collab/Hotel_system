import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import os from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

// Import database and routes
import { config, getStartupWarnings } from './config.js';
import { initializeDatabase } from './database.js';
import { setIO } from './socket.js';
import authRoutes from './routes/auth.js';
import tablesRoutes from './routes/tables.js';
import menuRoutes from './routes/menu.js';
import ordersRoutes from './routes/orders.js';
import qrRoutes from './routes/qr.js';
import analyticsRoutes from './routes/analytics.js';

// Get __dirname equivalent for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Express and HTTP server
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});
setIO(io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Get local IP address for LAN connectivity
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

function padRight(value, width) {
  const text = String(value);
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function formatPin(value) {
  return value ? String(value) : '(not set)';
}

function printUrl(label, url) {
  return `  ${padRight(label, 14)} ${url}`;
}

/**
 * API Routes - mounted under /api
 */
app.use('/api/auth', authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/analytics', analyticsRoutes);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/**
 * Socket.IO event handlers
 */
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  /**
   * Customer joins table room
   * Allows real-time updates for a specific table
   */
  socket.on('join_table', (data) => {
    const { tableId } = data || {};
    if (!Number.isInteger(Number(tableId)) || Number(tableId) < 1) {
      socket.emit('app_error', { message: 'Invalid table ID' });
      return;
    }
    const roomName = `table_${tableId}`;
    socket.join(roomName);
    console.log(`👤 Customer joined table ${tableId}`);
  });

  /**
   * Receptionist joins with JWT verification
   * Gets access to receptionist-specific events
   */
  socket.on('join_receptionist', (data) => {
    const { token } = data || {};
    try {
      if (!token) throw new Error('Missing token');
      const verified = jwt.verify(token, config.jwtSecret);
      if (verified.role === 'receptionist') {
        socket.join('receptionist');
        console.log(`📞 Receptionist joined`);
      }
    } catch (error) {
      console.error('Receptionist auth error:', error.message);
      socket.emit('app_error', { message: 'Invalid token' });
    }
  });

  /**
   * Admin joins with JWT verification
   * Gets access to admin-specific events
   */
  socket.on('join_admin', (data) => {
    const { token } = data || {};
    try {
      if (!token) throw new Error('Missing token');
      const verified = jwt.verify(token, config.jwtSecret);
      if (verified.role === 'admin') {
        socket.join('admin');
        socket.join('receptionist');
        console.log(`⚙️ Admin joined`);
      }
    } catch (error) {
      console.error('Admin auth error:', error.message);
      socket.emit('app_error', { message: 'Invalid token' });
    }
  });

  /**
   * Handle disconnect
   */
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

/**
 * Expose Socket.IO instance for routes to emit events
 */
export { io };

app.use((error, req, res, next) => {
  console.error('Unhandled request error:', error);
  if (res.headersSent) {
    return next(error);
  }
  return res.status(500).json({ error: 'Internal server error' });
});

/**
 * Start server
 */
function printStartupBanner() {
  const PORT = config.port;
  const localUrl = `http://${localIP}:${PORT}`;
  const localhostUrl = `http://localhost:${PORT}`;
  const portalUrl = `${localUrl}/`;
  const customerUrl = `${localUrl}/table/index.html?table=1`;
  const receptionistUrl = `${localUrl}/receptionist/index.html`;
  const adminUrl = `${localUrl}/admin/index.html`;

  console.log(`
╔════════════════════════════════════════════════════════════╗
║         🏨 HOTEL ORDERING SYSTEM - NEPAL 🇳🇵               ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  ✅ Server is running!                                    ║
║                                                            ║
║  PIN Codes:                                                ║
║  • Admin PIN:        ${padRight(formatPin(config.adminPin), 30)}║
║  • Receptionist PIN: ${padRight(formatPin(config.receptionistPin), 30)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Application URLs:
${printUrl('Staff Portal:', portalUrl)}
${printUrl('Local IP:', localUrl)}
${printUrl('Localhost:', localhostUrl)}
${printUrl('Customer:', customerUrl)}
${printUrl('Receptionist:', receptionistUrl)}
${printUrl('Admin:', adminUrl)}
  `);

  getStartupWarnings().forEach((warning) => {
    console.warn(`⚠️  ${warning}`);
  });
}

function startServer() {
  try {
    initializeDatabase();
  } catch (error) {
    console.error('Server startup aborted because database initialization failed:', error);
    process.exitCode = 1;
    return;
  }

  httpServer.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set PORT to another value and restart.`);
    } else {
      console.error('Server startup error:', error);
    }
    process.exitCode = 1;
  });

  httpServer.listen(config.port, printStartupBanner);
}

startServer();

export default app;
