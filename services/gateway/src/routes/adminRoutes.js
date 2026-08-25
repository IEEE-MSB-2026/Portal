const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyInternalServiceAuth } = require('../middlewares/internalAuth');

const router = express.Router();

router.post('/roles/assign', verifyInternalServiceAuth, adminController.assignRole);

module.exports = router;
