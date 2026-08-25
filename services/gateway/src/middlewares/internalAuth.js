const config = require('../config');

function verifyInternalServiceAuth(req, res, next) {
  const serviceToken = req.headers['x-service-token'];
  if (!serviceToken || serviceToken !== config.iamServiceAuthToken) {
    return res.status(401).json({ error: 'Unauthorized internal service request: invalid or missing x-service-token' });
  }
  next();
}

module.exports = {
  verifyInternalServiceAuth,
};
