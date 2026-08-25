const express = require('express');
const proxyController = require('../controllers/proxyController');
const { fileSignatureLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Proxy to Core Platform Service
router.use('/core', proxyController.proxyToCore);

// Proxy to Event Register Service
router.use('/events', proxyController.proxyToEvents);

// Proxy to File Service with signature rate limiter
router.use('/files', fileSignatureLimiter, proxyController.proxyToFiles);

module.exports = router;
