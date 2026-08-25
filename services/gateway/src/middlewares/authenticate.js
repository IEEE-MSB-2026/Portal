const jwt = require('jsonwebtoken');
const config = require('../config');
const userRepository = require('../repositories/userRepository');

async function requireJwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header with Bearer token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await userRepository.findById(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: 'User not found or session expired' });
    }

    req.user = user;
    req.decoded = decoded;
    req.identity = {
      userId: decoded.sub,
      email: decoded.email,
      role: decoded.role || user.defaultRole,
      scopeType: decoded.scopeType || user.defaultScopeType,
      scopeId: decoded.scopeId || user.defaultScopeId,
      committeeId: decoded.committeeId !== undefined ? decoded.committeeId : (decoded.scopeType === 'committee' ? decoded.scopeId : null),
      committeeName: decoded.committeeName || null,
    };

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalJwtAuth(req, res, next) {
  req.identity = {
    userId: 'guest-1',
    email: 'guest@ieee.local',
    role: 'visitor',
    scopeType: 'global',
    scopeId: 'global',
  };

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      req.decoded = decoded;
      req.identity = {
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'member',
        scopeType: decoded.scopeType || 'global',
        scopeId: decoded.scopeId || 'global',
      };
    } catch {
      // Invalid token falls back to visitor identity
    }
  }

  next();
}

function resolveIdentity(req) {
  if (req.identity) {
    return req.identity;
  }

  let identity = {
    userId: 'guest-1',
    email: 'guest@ieee.local',
    role: 'visitor',
    scopeType: 'global',
    scopeId: 'global',
  };

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      identity = {
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'member',
        scopeType: decoded.scopeType || 'global',
        scopeId: decoded.scopeId || 'global',
      };
    } catch {
      // Fallback
    }
  }

  return identity;
}

module.exports = {
  optionalJwtAuth,
  requireJwtAuth,
  resolveIdentity,
};
