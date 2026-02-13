const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.logLevel,
  base: {
    service: 'core-platform',
    env: config.env,
  },
  transport: config.env === 'development'
    ? {
        target: 'pino-pretty',
        options: { colorize: true },
      }
    : undefined,
});

module.exports = logger;
