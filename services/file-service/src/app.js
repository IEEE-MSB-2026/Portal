const express = require('express');
const cors = require('cors');
const config = require('./config');
const fileRoutes = require('./routes/fileRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'portal-file-service',
    cloudinaryConfigured: config.cloudinary.isConfigured,
    uploadMode: config.cloudinary.isConfigured ? 'cloudinary' : 'test_mock',
  });
});

// File routes mounted on root / and /api/files
app.use('/api/files', fileRoutes);
app.use('/', fileRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('[FileService Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

module.exports = app;
