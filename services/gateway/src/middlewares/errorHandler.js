function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error(`[Gateway Error] ${req.method} ${req.originalUrl}:`, err);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && err.details ? { details: err.details } : {}),
  });
}

module.exports = {
  errorHandler,
};
