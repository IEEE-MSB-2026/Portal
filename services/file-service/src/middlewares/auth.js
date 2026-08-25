const crypto = require('crypto');
const config = require('../config');

const isProduction = process.env.NODE_ENV === 'production';
const MAX_DRIFT_SECONDS = 300; // 5 minutes

function parseAuthIdentity(req, res, next) {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  const userEmail = req.headers['x-user-email'];
  const scopeType = req.headers['x-scope-type'] || 'global';
  const scopeId = req.headers['x-scope-id'] || 'global';
  const signature = req.headers['x-gateway-signature'];
  const timestamp = req.headers['x-gateway-timestamp'];

  // 1. Check Gateway HMAC signature if signature or timestamp header is provided
  if (signature || timestamp) {
    if (!signature || !timestamp || !userId) {
      return res.status(401).json({ error: 'Incomplete gateway authentication headers' });
    }

    // Prevent replay attacks
    const parsedTime = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Number.isNaN(parsedTime) || Math.abs(now - parsedTime) > MAX_DRIFT_SECONDS) {
      return res.status(401).json({ error: 'Gateway signature timestamp expired or invalid' });
    }

    // Construct canonical payload matching Gateway signature contract
    const canonicalPayload = [
      String(req.method || 'GET').toUpperCase(),
      String(req.originalUrl || req.url || ''),
      String(userId || ''),
      String(userRole || 'member'),
      String(scopeType),
      String(scopeId),
      String(timestamp),
    ].join('\n');

    const expectedSignature = crypto
      .createHmac('sha256', config.gatewaySharedSecret)
      .update(canonicalPayload)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');

    const isValid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

    if (isValid) {
      req.identity = {
        userId,
        email: userEmail || `${userId}@ieee.local`,
        role: userRole || 'member',
        scopeType,
        scopeId,
      };
      return next();
    }

    return res.status(401).json({ error: 'Invalid Gateway HMAC signature' });
  }

  // 2. In production, unsigned requests claiming a user identity are strictly rejected
  if (isProduction && userId) {
    return res.status(401).json({ error: 'Unsigned requests with identity headers are rejected in production' });
  }

  // 3. Development / test unsigned header fallback
  if (!isProduction && userId) {
    req.identity = {
      userId,
      email: userEmail || `${userId}@ieee.local`,
      role: userRole || 'member',
      scopeType,
      scopeId,
    };
    return next();
  }

  // 4. Default unauthenticated guest context
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
