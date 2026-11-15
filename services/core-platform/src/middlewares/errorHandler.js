const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = status >= 500 ? 'Internal server error' : err.message;

  if (status >= 500) {
    logger.error({ err, requestId: req.requestId }, 'Unhandled request error');
  } else {
    logger.warn({ err, requestId: req.requestId }, 'Client request error');
  }

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
