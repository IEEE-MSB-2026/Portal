const { coreRoutesCatalog } = require('../routes/catalog');

function getCoreRoutes(req, res) {
  res.status(200).json({
    message: 'Core route catalog',
    routes: coreRoutesCatalog,
  });
}

module.exports = {
  getCoreRoutes,
};
