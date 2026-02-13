const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Core platform service listening');
});
