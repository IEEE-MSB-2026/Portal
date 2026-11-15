const express = require('express');
const config = require('./config');

const requestIdMiddleware = require('./middlewares/requestId');
const errorHandler = require('./middlewares/errorHandler');
const healthRoutes = require('./routes/healthRoutes');
const publicRoutes = require('./routes/publicRoutes');
const coreRoutes = require('./routes/coreRoutes');

const app = express();

app.use('/core/pr/campaigns', express.json({ limit: config.prCampaignBodyLimit }));
app.use('/core/pr/campaigns', express.urlencoded({ extended: true, limit: config.prCampaignBodyLimit }));
app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));
app.use(requestIdMiddleware);

app.use(healthRoutes);
app.use('/public', publicRoutes);
app.use('/core', coreRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
