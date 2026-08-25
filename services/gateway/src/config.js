if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/ieee_core',
  jwtSecret: process.env.JWT_SECRET || 'portal-jwt-secret-key-production-2026',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10),
  gatewaySharedSecret: process.env.GATEWAY_SHARED_SECRET || 'dev-gateway-secret-change-in-prod',
  claimsHmacSecret: process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret',
  corePlatformUrl: process.env.CORE_PLATFORM_URL || 'http://localhost:5070',
  eventRegisterUrl: process.env.EVENT_REGISTER_URL || 'http://localhost:5050',
  emailServiceUrl: process.env.EMAIL_SERVICE_URL || 'http://localhost:3060',
  fileServiceUrl: process.env.FILE_SERVICE_URL || 'http://localhost:5080',
  iamServiceAuthToken: process.env.IAM_SERVICE_AUTH_TOKEN || process.env.GATEWAY_SHARED_SECRET || 'dev-gateway-secret-change-in-prod',
};
