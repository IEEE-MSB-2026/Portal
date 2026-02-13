const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error({ err, requestId: req.requestId }, 'Unhandled request error');

  const status = err.status || 500;
  const message = status >= 500 ? 'Internal server error' : err.message;
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
