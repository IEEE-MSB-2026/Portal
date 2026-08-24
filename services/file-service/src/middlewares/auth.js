const crypto = require('crypto');
const config = require('../config');

const ALLOWED_ROLES = new Set([
  'admin',
  'officer',
  'lead',
  'member',
  'publisher',
  'editor',
  'event_organizer',
  'event_scanner',
  'applicant',
  'visitor',
]);

function parseAuthIdentity(req, res, next) {
  // 1. Check Gateway signed headers if present
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  const userEmail = req.headers['x-user-email'];
  const scopeType = req.headers['x-scope-type'] || 'global';
  const scopeId = req.headers['x-scope-id'] || 'global';
  const signature = req.headers['x-gateway-signature'];
  const timestamp = req.headers['x-gateway-timestamp'];

  if (userId && signature && timestamp) {
    const canonicalPayload = [
      String(req.method || 'GET').toUpperCase(),
      String(req.originalUrl || req.url || ''),
      String(userId),
      String(userRole || 'member'),
      String(scopeType),
      String(scopeId),
      String(timestamp),
    ].join('\n');

    const expectedSignature = crypto
      .createHmac('sha256', config.gatewaySharedSecret)
      .update(canonicalPayload)
      .digest('hex');

    // If signature matches, attach verified identity
    if (signature === expectedSignature) {
      req.identity = {
        userId,
        email: userEmail,
        role: userRole || 'member',
        scopeType,
        scopeId,
      };
      return next();
    }
  }

  // 2. Direct demo / development header fallback
  if (userId) {
    req.identity = {
      userId,
      email: userEmail || `${userId}@ieee.local`,
      role: userRole || 'member',
      scopeType,
      scopeId,
    };
    return next();
  }

  // 3. Unauthenticated default identity: visitor / applicant
  req.identity = {
    userId: 'guest-1',
    email: 'guest@ieee.local',
    role: 'applicant',
    scopeType: 'global',
    scopeId: 'global',
  };

  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.identity || !roles.includes(req.identity.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = {
  parseAuthIdentity,
  requireRole,
};
