import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * Middleware to verify JWT token and attach user data to request
 * Supports optional role-based access control
 */
export function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    try {
      if (!Array.isArray(allowedRoles)) {
        allowedRoles = [];
      }

      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.slice(7); // Remove 'Bearer ' prefix

      // Verify token
      const decoded = jwt.verify(token, config.jwtSecret);
      req.user = decoded;

      // Check role if specified
      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      console.error('Auth middleware error:', error.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/**
 * Optional authentication middleware
 * Does not reject if no token, but verifies if provided
 */
export function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, config.jwtSecret);
      req.user = decoded;
    }
    next();
  } catch (error) {
    // If token is invalid, just continue without user
    next();
  }
}

export default { requireAuth, optionalAuth };
