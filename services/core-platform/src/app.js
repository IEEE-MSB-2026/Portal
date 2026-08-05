const express = require('express');

const requestIdMiddleware = require('./middlewares/requestId');
const errorHandler = require('./middlewares/errorHandler');
const healthRoutes = require('./routes/healthRoutes');
const publicRoutes = require('./routes/publicRoutes');
const coreRoutes = require('./routes/coreRoutes');

const app = express();

app.use(express.json());
app.use(requestIdMiddleware);

app.use(healthRoutes);
app.use('/public', publicRoutes);
app.use('/core', coreRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
