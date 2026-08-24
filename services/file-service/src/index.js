const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`[FileService] Running on port ${config.port} (Cloudinary: ${config.cloudinary.isConfigured ? 'CONNECTED' : 'MOCK/LOCAL'})`);
});
