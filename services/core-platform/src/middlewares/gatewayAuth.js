const config = require('../config');
const { verifyGatewayRequest } = require('../auth/gatewayContract');
const usersRepository = require('../repositories/usersRepository');
const committeesRepository = require('../repositories/committeesRepository');

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

const authzService = require('../services/authzService');

function requireCommitteeScope(committeeIdParam = 'committeeId') {
  return async (req, res, next) => {
    if (!req.identity) {
      return res.status(401).json({ error: 'Unauthorized gateway request' });
    }

    const committeeId = req.params[committeeIdParam];
    if (!committeeId) {
      return res.status(400).json({ error: 'Invalid committeeId format' });
    }

    const isGet = req.method === 'GET' || req.method === 'HEAD';

    // 1. Admin always has full access (read & write)
    const isAdmin = req.identity.role === 'admin' || req.identity.userRef?.defaultRole === 'admin';
    if (isAdmin) {
      return next();
    }

    // 2. ExCom Officers have read-only follow-up access to all committee workspaces
    const isOfficer = req.identity.role === 'officer' || req.identity.userRef?.defaultRole === 'officer';
    if (isOfficer) {
      if (isGet) return next();
      if (req.identity.scopeType === 'committee' && req.identity.scopeId === committeeId) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: Officer write access requires committee lead/member role' });
    }

    // 3. HR Leads & HR Committee members have content management + read access
    const isHRLead = await authzService.isHrCommitteeLead(req.identity);
    const dbRole = req.identity.userRefId
      ? await committeesRepository.getMembershipRole(req.identity.userRefId, committeeId)
      : null;
    const isHR = req.identity.role === 'hr' || dbRole === 'hr' || isHRLead;

    if (isHR) {
      if (isGet) return next();
      // Tasks are strictly for committee leads and assigned members
      const reqPath = req.originalUrl || req.path || '';
      if (reqPath.includes('/tasks')) {
        return res.status(403).json({ error: 'Forbidden: HR role cannot create or modify tasks' });
      }
      // Deletions are strictly for committee leads
      if (req.method === 'DELETE') {
        return res.status(403).json({ error: 'Forbidden: Only committee lead can delete resources or assignments' });
      }
      // Allow assignments, grading submissions, announcements, resources
      return next();
    }

    // 4. If user is in committee scope matching this committee
    if (req.identity.scopeType === 'committee' && req.identity.scopeId === committeeId) {
      return next();
    }

    // 5. Fallback: check database membership
    if (dbRole) {
      return next();
    }

    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = {
  attachUserRef,
  requireCommitteeScope,
  requireRole,
  verifyGatewaySignature,
};
