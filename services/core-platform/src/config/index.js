if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}
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

function parseOptionalUuid(name) {
  const value = optionalEnv(name);
  if (!value) return null;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a valid UUID`);
  }

  return value.toLowerCase();
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

function parseEnum(name, allowedValues, defaultValue) {
  const value = optionalEnv(name);
  if (!value) return defaultValue;

  const normalized = value.toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(', ')}`);
  }

  return normalized;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: parsePort(requireEnv('PORT')),
  databaseUrl: requireEnv('DATABASE_URL'),
  gatewaySharedSecret: process.env.CORE_GATEWAY_SHARED_SECRET || process.env.GATEWAY_SHARED_SECRET || requireEnv('CORE_GATEWAY_SHARED_SECRET'),
  gatewayMaxSkewSeconds: 60,
  notification: {
    emailServiceUrl: parseOptionalUrl('EMAIL_SERVICE_URL'),
    emailServiceAuthToken: optionalEnv('EMAIL_SERVICE_AUTH_TOKEN'),
    emailServiceTimeoutMs: parsePositiveInteger('EMAIL_SERVICE_TIMEOUT_MS', 15000),
  },
  iam: {
    serviceUrl: parseOptionalUrl('IAM_SERVICE_URL'),
    serviceAuthToken: optionalEnv('IAM_SERVICE_AUTH_TOKEN'),
    serviceTimeoutMs: parsePositiveInteger('IAM_SERVICE_TIMEOUT_MS', 3000),
  },
  hr: {
    acceptGovernanceMode: parseEnum('HR_ACCEPT_GOVERNANCE_MODE', ['mode_a', 'mode_b'], 'mode_a'),
  },
  pr: {
    campaignMaxRecipients: parsePositiveInteger('PR_CAMPAIGN_MAX_RECIPIENTS', 500),
  },
  media: {
    defaultCommitteeId: parseOptionalUuid('MEDIA_COMMITTEE_ID'),
  },
};

module.exports = config;
