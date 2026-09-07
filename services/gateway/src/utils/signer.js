const crypto = require('crypto');
const config = require('../config');

function buildCoreGatewayHeaders(firstArg, pathArg, identityArg, secretArg) {
  let method, path, userId, email, role, scopeType, scopeId, secret;

  if (typeof firstArg === 'object' && firstArg !== null && !pathArg) {
    method = firstArg.method;
    path = firstArg.path;
    userId = firstArg.userId;
    email = firstArg.email;
    role = firstArg.role;
    scopeType = firstArg.scopeType;
    scopeId = firstArg.scopeId;
    secret = firstArg.secret || config.gatewaySharedSecret;
  } else {
    method = firstArg;
    path = pathArg;
    const identity = identityArg || {};
    userId = identity.userId;
    email = identity.email;
    role = identity.role;
    scopeType = identity.scopeType;
    scopeId = identity.scopeId;
    secret = secretArg || config.gatewaySharedSecret;
  }

  const effectiveUserId = String(userId || 'guest-1');
  const effectiveRole = String(role || 'visitor');
  const effectiveScopeType = String(scopeType || 'global');
  const effectiveScopeId = String(scopeId || 'global');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const canonicalPayload = [
    String(method || 'GET').toUpperCase(),
    String(path || ''),
    effectiveUserId,
    effectiveRole,
    effectiveScopeType,
    effectiveScopeId,
    timestamp,
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(canonicalPayload)
    .digest('hex');

  return {
    'x-user-id': effectiveUserId,
    'x-user-email': String(email || `${effectiveUserId}@ieee.local`),
    'x-user-role': effectiveRole,
    'x-scope-type': effectiveScopeType,
    'x-scope-id': effectiveScopeId,
    'x-gateway-timestamp': timestamp,
    'x-gateway-signature': signature,
    'content-type': 'application/json',
  };
}

function buildEventClaimsHeaders(firstArg, secretArg) {
  let role, scopeType, scopeId, expSeconds = 900, secret;

  if (firstArg && typeof firstArg === 'object') {
    role = firstArg.role;
    scopeType = firstArg.scopeType;
    scopeId = firstArg.scopeId;
    expSeconds = firstArg.expSeconds || 900;
  }
  secret = secretArg || config.claimsHmacSecret;

  const exp = Math.floor(Date.now() / 1000) + expSeconds;
  const payload = {
    role: role || 'admin',
    scope_type: scopeType || 'global',
    scope_id: scopeType === 'global' ? null : scopeId,
    exp,
  };
  if (firstArg?.userId || firstArg?.sub) {
    payload.user_id = firstArg.userId || firstArg.sub;
  }
  const rawClaims = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(rawClaims)
    .digest('hex');

  return {
    'x-auth-claims': rawClaims,
    'x-auth-signature': signature,
    'content-type': 'application/json',
  };
}

module.exports = {
  buildCoreGatewayHeaders,
  buildEventClaimsHeaders,
};
