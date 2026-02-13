const express = require('express');

const dashboardController = require('../controllers/dashboardController');
const workspaceController = require('../controllers/workspaceController');
const taskController = require('../controllers/taskController');
const resourceController = require('../controllers/resourceController');
const announcementController = require('../controllers/announcementController');
const membershipController = require('../controllers/membershipController');
const routesController = require('../controllers/routesController');
const { attachUserRef, requireCommitteeScope, verifyGatewaySignature } = require('../middlewares/gatewayAuth');

const router = express.Router();

router.use(verifyGatewaySignature);
router.use(attachUserRef);

router.get('/me/dashboard', dashboardController.getMyDashboard);
router.get('/committees/:committeeId/workspace', requireCommitteeScope('committeeId'), workspaceController.getCommitteeWorkspace);
router.post('/committees/:committeeId/tasks', requireCommitteeScope('committeeId'), taskController.createTask);
router.get('/committees/:committeeId/resources', requireCommitteeScope('committeeId'), resourceController.listCommitteeResources);
router.post('/committees/:committeeId/resources', requireCommitteeScope('committeeId'), resourceController.createCommitteeResource);
router.get('/committees/:committeeId/announcements', requireCommitteeScope('committeeId'), announcementController.listCommitteeAnnouncements);
router.post('/committees/:committeeId/announcements', requireCommitteeScope('committeeId'), announcementController.createCommitteeAnnouncement);
router.get('/committees/:committeeId/memberships', requireCommitteeScope('committeeId'), membershipController.listCommitteeMemberships);
router.post('/committees/:committeeId/memberships', requireCommitteeScope('committeeId'), membershipController.upsertCommitteeMembership);
router.delete('/committees/:committeeId/memberships/:userId', requireCommitteeScope('committeeId'), membershipController.removeCommitteeMembership);
router.patch('/tasks/:taskId/status', taskController.updateTaskStatus);
router.get('/routes', routesController.getCoreRoutes);

module.exports = router;
