const crypto = require('crypto');
const config = require('./config');

function buildCoreGatewayHeaders({ method, path, userId, email, role, scopeType, scopeId }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const canonicalPayload = [
    String(method || 'GET').toUpperCase(),
    String(path || ''),
    String(userId || ''),
    String(role || 'member'),
    String(scopeType || 'global'),
    String(scopeId || 'global'),
    timestamp,
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', config.gatewaySharedSecret)
    .update(canonicalPayload)
    .digest('hex');

  return {
    'x-user-id': String(userId || ''),
    'x-user-email': String(email || ''),
    'x-user-role': String(role || 'member'),
    'x-scope-type': String(scopeType || 'global'),
    'x-scope-id': String(scopeId || 'global'),
    'x-gateway-timestamp': timestamp,
    'x-gateway-signature': signature,
    'content-type': 'application/json',
  };
}

function buildEventClaimsHeaders({ role, scopeType, scopeId, expSeconds = 900 }) {
  const exp = Math.floor(Date.now() / 1000) + expSeconds;
  const payload = {
    role: role || 'admin',
    scope_type: scopeType || 'global',
    scope_id: scopeType === 'global' ? null : scopeId,
    exp,
  };
  const rawClaims = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.claimsHmacSecret)
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
