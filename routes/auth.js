import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login with PIN for admin or receptionist
 * Body: { role: 'admin'|'receptionist', pin: '0000' }
 * Returns: { token, role, expiresIn }
 */
router.post('/login', (req, res) => {
  try {
    const { role, pin } = req.body;

    // Validate input
    if (!role || !pin) {
      return res.status(400).json({ error: 'Role and PIN are required' });
    }

    if (!['admin', 'receptionist'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Validate PIN
    const envPin = role === 'admin' ? config.adminPin : config.receptionistPin;
    if (pin !== envPin) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    // Generate JWT token (24 hour expiry)
    const token = jwt.sign(
      { role, loginTime: new Date().toISOString() },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      role,
      expiresIn: '24h',
      message: `${role} logged in successfully`
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/verify
 * Verify JWT token validity
 * Headers: Authorization: Bearer <token>
 * Returns: { valid, role }
 */
router.post('/verify', requireAuth(), (req, res) => {
  try {
    res.json({
      valid: true,
      role: req.user.role,
      loginTime: req.user.loginTime
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

export default router;
