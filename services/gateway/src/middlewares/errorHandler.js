function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error(`[Gateway Error] ${req.method} ${req.originalUrl}:`, err);
  }

  if (err.retryAfterSeconds) {
    res.set('Retry-After', String(err.retryAfterSeconds));
  }

  res.status(status).json({
    error: message,
    ...(err.retryAfterSeconds ? { cooldownSeconds: err.retryAfterSeconds, retryAfterSeconds: err.retryAfterSeconds } : {}),
    ...(process.env.NODE_ENV !== 'production' && err.details ? { details: err.details } : {}),
  });
}

module.exports = {
  errorHandler,
};
