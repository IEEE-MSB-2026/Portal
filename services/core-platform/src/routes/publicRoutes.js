const express = require('express');
const publicController = require('../controllers/publicController');

const router = express.Router();

router.get('/committees', publicController.listPublicCommittees);
router.get('/pr/announcements', publicController.listPublicAnnouncements);
router.get('/announcements', publicController.listPublicAnnouncements);
router.get('/media/albums', publicController.listPublicAlbums);

module.exports = router;
