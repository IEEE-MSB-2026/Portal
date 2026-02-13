const { HttpError } = require('./httpErrors');

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('invalid cursor payload');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
}

function parseLimit(raw, fallback = 20, max = 100) {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new HttpError(400, `limit must be an integer between 1 and ${max}`);
  }
  return parsed;
}

module.exports = {
  decodeCursor,
  encodeCursor,
  parseLimit,
};
