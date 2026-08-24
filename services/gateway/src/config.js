require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'portal-jwt-secret-key-production-2026',
  gatewaySharedSecret: process.env.GATEWAY_SHARED_SECRET || 'dev-gateway-secret-change-in-prod',
  claimsHmacSecret: process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret',
  corePlatformUrl: process.env.CORE_PLATFORM_URL || 'http://localhost:3000',
  eventRegisterUrl: process.env.EVENT_REGISTER_URL || 'http://localhost:5000',
  emailServiceUrl: process.env.EMAIL_SERVICE_URL || 'http://localhost:3060',
  fileServiceUrl: process.env.FILE_SERVICE_URL || 'http://localhost:5080',
  iamServiceAuthToken: process.env.IAM_SERVICE_AUTH_TOKEN || process.env.GATEWAY_SHARED_SECRET || 'dev-gateway-secret-change-in-prod',
};


