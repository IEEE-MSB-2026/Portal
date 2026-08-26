const express = require('express');
const publicController = require('../controllers/publicController');

const router = express.Router();

router.get('/committees', publicController.listPublicCommittees);
router.get('/pr/announcements', publicController.listPublicAnnouncements);
router.get('/announcements', publicController.listPublicAnnouncements);
router.get('/media/albums', publicController.listPublicAlbums);
router.get('/officers', publicController.listPublicOfficers);
router.get('/officers/seasons', publicController.listPublicSeasons);

module.exports = router;
