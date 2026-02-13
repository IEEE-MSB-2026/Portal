const express = require('express');

const dashboardController = require('../controllers/dashboardController');
const workspaceController = require('../controllers/workspaceController');
const taskController = require('../controllers/taskController');
const routesController = require('../controllers/routesController');
const { attachUserRef, requireCommitteeScope, verifyGatewaySignature } = require('../middlewares/gatewayAuth');

const router = express.Router();

router.use(verifyGatewaySignature);
router.use(attachUserRef);

router.get('/me/dashboard', dashboardController.getMyDashboard);
router.get('/committees/:committeeId/workspace', requireCommitteeScope('committeeId'), workspaceController.getCommitteeWorkspace);
router.post('/committees/:committeeId/tasks', requireCommitteeScope('committeeId'), taskController.createTask);
router.patch('/tasks/:taskId/status', taskController.updateTaskStatus);
router.get('/routes', routesController.getCoreRoutes);

module.exports = router;
