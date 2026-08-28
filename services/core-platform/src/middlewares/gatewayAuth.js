const config = require('../config');
const { verifyGatewayRequest } = require('../auth/gatewayContract');
const usersRepository = require('../repositories/usersRepository');

const GLOBAL_COMMITTEE_BYPASS_ROLES = new Set(['admin', 'officer']);

function verifyGatewaySignature(req, res, next) {
  try {
    const identity = verifyGatewayRequest({
      method: req.method,
      path: `${req.baseUrl || ''}${req.path || ''}`,
      headers: req.headers,
      secret: config.gatewaySharedSecret,
      maxSkewSeconds: config.gatewayMaxSkewSeconds,
    });

    req.identity = identity;
    return next();
  } catch (error) {
    console.error(`[Core-Platform Gateway Auth Error] ${req.method} ${req.originalUrl || req.path}: ${error.message}`);
    return res.status(401).json({ error: 'Unauthorized gateway request', details: error.message });
  }
}

async function attachUserRef(req, res, next) {
  try {
    const userRef = await usersRepository.ensureUserRef({
      externalUserId: req.identity.externalUserId,
      email: req.identity.email,
    });

    req.identity.userRefId = userRef.id;
    req.identity.userRef = userRef;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.identity || !allowedRoles.includes(req.identity.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

function requireCommitteeScope(committeeIdParam = 'committeeId') {
  return (req, res, next) => {
    if (!req.identity) {
      return res.status(401).json({ error: 'Unauthorized gateway request' });
    }

    const committeeId = req.params[committeeIdParam];
    if (!committeeId) {
      return res.status(400).json({ error: 'Invalid committeeId format' });
    }

    if (req.identity.scopeType === 'global') {
      if (!GLOBAL_COMMITTEE_BYPASS_ROLES.has(req.identity.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return next();
    }

    if (req.identity.scopeType !== 'committee') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (req.identity.scopeId !== committeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  };
}

module.exports = {
  attachUserRef,
  requireCommitteeScope,
  requireRole,
  verifyGatewaySignature,
};
