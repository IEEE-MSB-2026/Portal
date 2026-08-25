function getHealth(req, res) {
  res.json({
    status: 'ok',
    service: 'portal-gateway',
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  getHealth,
};
