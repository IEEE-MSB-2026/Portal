const crypto = require('crypto');

const REQUIRED_HEADERS = [
  'x-user-id',
  'x-user-email',
  'x-user-role',
  'x-scope-type',
  'x-scope-id',
  'x-gateway-timestamp',
  'x-gateway-signature',
];

const ALLOWED_ROLES = new Set(['admin', 'lead', 'member']);
const ALLOWED_SCOPE_TYPES = new Set(['global', 'committee']);

function normalizeHeader(value) {
  if (Array.isArray(value)) return normalizeHeader(value[0]);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildCanonicalPayload({ method, path, userId, userRole, scopeType, scopeId, timestamp }) {
  return [
    String(method || '').toUpperCase(),
    String(path || ''),
    String(userId || ''),
    String(userRole || ''),
    String(scopeType || ''),
    String(scopeId || ''),
    String(timestamp || ''),
  ].join('\n');
}

function signCanonicalPayload(canonicalPayload, secret) {
  return crypto.createHmac('sha256', secret).update(canonicalPayload).digest('hex');
}

function safeTimingEquals(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseTimestamp(raw) {
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid gateway timestamp');
  }
  return parsed;
}

function verifyGatewayRequest({ method, path, headers, secret, maxSkewSeconds }) {
  const normalized = {};
  for (const header of REQUIRED_HEADERS) {
    const value = normalizeHeader(headers[header]);
    if (!value) {
      throw new Error(`Missing required header: ${header}`);
    }
    normalized[header] = value;
  }

  const role = normalized['x-user-role'];
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error('Invalid user role');
  }

  const scopeType = normalized['x-scope-type'];
  if (!ALLOWED_SCOPE_TYPES.has(scopeType)) {
    throw new Error('Invalid scope type');
  }

  const scopeId = normalized['x-scope-id'];
  if (scopeType === 'global' && scopeId !== 'global') {
    throw new Error('Global scope requires x-scope-id=global');
  }
  if (scopeType === 'committee' && !scopeId) {
    throw new Error('Committee scope requires x-scope-id');
  }

  const timestamp = parseTimestamp(normalized['x-gateway-timestamp']);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > maxSkewSeconds) {
    throw new Error('Gateway signature timestamp outside allowed skew');
  }

  const canonicalPayload = buildCanonicalPayload({
    method,
    path,
    userId: normalized['x-user-id'],
    userRole: role,
    scopeType,
    scopeId,
    timestamp,
  });

  const expectedSignature = signCanonicalPayload(canonicalPayload, secret);
  if (!safeTimingEquals(expectedSignature, normalized['x-gateway-signature'])) {
    throw new Error('Invalid gateway signature');
  }

  return {
    externalUserId: normalized['x-user-id'],
    email: normalized['x-user-email'],
    role,
    scopeType,
    scopeId,
    timestamp,
  };
}

function buildGatewaySignedHeaders({
  method,
  path,
  userId,
  userEmail,
  userRole,
  scopeType,
  scopeId,
  timestamp,
  secret,
}) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const canonicalPayload = buildCanonicalPayload({
    method,
    path,
    userId,
    userRole,
    scopeType,
    scopeId,
    timestamp: ts,
  });
  const signature = signCanonicalPayload(canonicalPayload, secret);

  return {
    'x-user-id': userId,
    'x-user-email': userEmail,
    'x-user-role': userRole,
    'x-scope-type': scopeType,
    'x-scope-id': scopeId,
    'x-gateway-timestamp': String(ts),
    'x-gateway-signature': signature,
  };
}

module.exports = {
  REQUIRED_HEADERS,
  buildGatewaySignedHeaders,
  buildCanonicalPayload,
  verifyGatewayRequest,
};
