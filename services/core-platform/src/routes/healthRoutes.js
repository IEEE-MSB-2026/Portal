const express = require('express');
const { query } = require('../db/pool');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    message: 'Core platform service is running',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/db', async (req, res, next) => {
  try {
    await query('SELECT 1');
    return res.status(200).json({
      message: 'Database is healthy',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
