require('dotenv').config();

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

const config = {
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: parsePort(requireEnv('PORT')),
  databaseUrl: requireEnv('DATABASE_URL'),
  gatewaySharedSecret: requireEnv('CORE_GATEWAY_SHARED_SECRET'),
  gatewayMaxSkewSeconds: 60,
};

module.exports = config;
