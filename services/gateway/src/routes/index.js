const express = require('express');
const authRoutes = require('./authRoutes');
const adminRoutes = require('./adminRoutes');
const proxyRoutes = require('./proxyRoutes');
const healthRoutes = require('./healthRoutes');

const router = express.Router();

// Health check
router.use('/health', healthRoutes);

// Auth endpoints
router.use('/api/auth', authRoutes);

// Admin / Internal IAM endpoints
router.use('/admin', adminRoutes);

// Reverse proxy endpoints (/api/core, /api/events, /api/files)
router.use('/api', proxyRoutes);

module.exports = router;
