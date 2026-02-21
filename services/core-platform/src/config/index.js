require('dotenv').config();
const { URL } = require('node:url');

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function parsePort(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('PORT must be a valid TCP port number');
  }
  return parsed;
}

function optionalEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalUrl(name) {
  const value = optionalEnv(name);
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${name} must be a valid URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must start with http:// or https://`);
  }

  return parsed.toString();
}

function parsePositiveInteger(name, defaultValue) {
  const value = optionalEnv(name);
  if (!value) return defaultValue;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: parsePort(requireEnv('PORT')),
  databaseUrl: requireEnv('DATABASE_URL'),
  gatewaySharedSecret: requireEnv('CORE_GATEWAY_SHARED_SECRET'),
  gatewayMaxSkewSeconds: 60,
  notification: {
    emailServiceUrl: parseOptionalUrl('EMAIL_SERVICE_URL'),
    emailServiceAuthToken: optionalEnv('EMAIL_SERVICE_AUTH_TOKEN'),
    emailServiceTimeoutMs: parsePositiveInteger('EMAIL_SERVICE_TIMEOUT_MS', 3000),
  },
};

module.exports = config;
