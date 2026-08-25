const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '100', 10), // Configurable limit per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
  skip: () => isTest,
});

const fileSignatureLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 signature generation requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many file upload requests. Please slow down.' },
  skip: () => isTest,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // Limit each IP to 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: () => isTest,
});

module.exports = {
  authLimiter,
  fileSignatureLimiter,
  generalLimiter,
};
