const config = require('../config');
const { verifyGatewayRequest } = require('../auth/gatewayContract');
const usersRepository = require('../repositories/usersRepository');

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
    return res.status(401).json({ error: 'Unauthorized gateway request' });
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
