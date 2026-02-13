const { randomUUID } = require('crypto');

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

module.exports = requestIdMiddleware;
