const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const KEY_LEN = 64;

async function hashPassword(password) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password must be a non-empty string');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LEN);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;

  const [salt, key] = parts;
  try {
    const derivedKey = await scryptAsync(password, salt, KEY_LEN);
    const keyBuffer = Buffer.from(key, 'hex');
    if (derivedKey.length !== keyBuffer.length) return false;
    return crypto.timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
};
