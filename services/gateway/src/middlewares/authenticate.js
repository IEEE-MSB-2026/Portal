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

    const activeScopeType = decoded.scopeType || user.defaultScopeType;
    const activeScopeId = decoded.scopeId || user.defaultScopeId;
    const activeRole = decoded.role || user.defaultRole;
    const matchingScope = (user.availableScopes || []).find(
      (s) => (s.scopeId === activeScopeId || s.committeeId === activeScopeId) && s.role === activeRole
    );
    const committeeSlug = decoded.committeeSlug || matchingScope?.committeeSlug || null;
    const committeeId = decoded.committeeId !== undefined ? decoded.committeeId : (matchingScope?.committeeId || (activeScopeType === 'committee' ? activeScopeId : null));

    req.user = user;
    req.decoded = decoded;
    req.identity = {
      userId: decoded.sub,
      email: decoded.email,
      role: activeRole,
      scopeType: activeScopeType,
      scopeId: activeScopeId,
      committeeId,
      committeeSlug,
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
