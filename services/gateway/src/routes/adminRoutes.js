const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyInternalServiceAuth } = require('../middlewares/internalAuth');

const router = express.Router();

router.post('/roles/assign', verifyInternalServiceAuth, adminController.assignRole);
router.post('/roles/revoke', verifyInternalServiceAuth, adminController.revokeRole);

module.exports = router;
