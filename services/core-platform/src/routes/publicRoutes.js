const express = require('express');

const prAnnouncementController = require('../controllers/prAnnouncementController');

const router = express.Router();

router.get('/pr/announcements', prAnnouncementController.listPublicAnnouncements);

module.exports = router;
