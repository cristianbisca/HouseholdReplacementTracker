const bcrypt = require('bcrypt');
const crypto = require('crypto');

// In-memory session store (reset on server restart)
const sessions = new Map();

// Admin credentials from environment variables
let adminUser = process.env.ADMIN_USER || 'admin';
let adminPasswordHash = null; // Set during initialization

// Session TTL: 30 days (in milliseconds)
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * Initialize auth module - hash the password from env var
 */
function initAuth() {
  const plainPassword = process.env.ADMIN_PASS || 'admin';
  adminPasswordHash = bcrypt.hashSync(plainPassword, 10);
  console.log(`[Auth] Initialized. Username: ${adminUser}`);
}

/**
 * Generate a random session token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Clean up expired sessions (run periodically)
 */
function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token);
    }
  }
}

// Clean up expired sessions every hour
setInterval(cleanupSessions, 60 * 60 * 1000);

/**
 * Authenticate username/password, return session token or null
 */
function login(username, password) {
  if (username !== adminUser) {
    return null;
  }

  const isValid = bcrypt.compareSync(password, adminPasswordHash);
  if (!isValid) {
    return null;
  }

  // Create new session
  const token = generateToken();
  sessions.set(token, {
    user: adminUser,
    createdAt: Date.now()
  });

  console.log(`[Auth] Login successful for user: ${adminUser}`);
  return token;
}

/**
 * Validate a session token, return session data or null
 */
function validateToken(token) {
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  // Check if session expired
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }

  // Update creation time to extend session (sliding expiry)
  session.createdAt = Date.now();
  return session;
}

/**
 * Invalidate a session token (logout)
 */
function logout(token) {
  if (token && sessions.has(token)) {
    sessions.delete(token);
    console.log(`[Auth] Logout successful`);
    return true;
  }
  return false;
}

/**
 * Express middleware to require authentication
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  const session = validateToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      requiresAuth: true
    });
  }

  req.user = session.user;
  next();
}

/**
 * Optional auth middleware - sets req.user if token is valid, but doesn't block
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  const session = validateToken(token);
  if (session) {
    req.user = session.user;
  }

  next();
}

module.exports = {
  initAuth,
  login,
  validateToken,
  logout,
  requireAuth,
  optionalAuth
};
