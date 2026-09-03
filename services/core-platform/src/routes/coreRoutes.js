const express = require('express');

const dashboardController = require('../controllers/dashboardController');
const workspaceController = require('../controllers/workspaceController');
const taskController = require('../controllers/taskController');
const resourceController = require('../controllers/resourceController');
const membershipController = require('../controllers/membershipController');
const committeeAnnouncementController = require('../controllers/committeeAnnouncementController');
const assignmentController = require('../controllers/assignmentController');
const hrCampaignController = require('../controllers/hrCampaignController');
const hrApplicationController = require('../controllers/hrApplicationController');
const hrOnboardingController = require('../controllers/hrOnboardingController');
const hrReportsController = require('../controllers/hrReportsController');
const prAnnouncementController = require('../controllers/prAnnouncementController');
const prCampaignController = require('../controllers/prCampaignController');
const mediaAlbumController = require('../controllers/mediaAlbumController');
const mediaBrandAssetController = require('../controllers/mediaBrandAssetController');
const mediaCoverageController = require('../controllers/mediaCoverageController');
const officerAdminController = require('../controllers/officerAdminController');
const userProfileController = require('../controllers/userProfileController');
const routesController = require('../controllers/routesController');
const { attachUserRef, requireCommitteeScope, verifyGatewaySignature } = require('../middlewares/gatewayAuth');
const { validateFiles } = require('../middlewares/validateFiles');

const router = express.Router();

router.use(verifyGatewaySignature);
router.use(attachUserRef);

router.get('/me/dashboard', dashboardController.getMyDashboard);
router.get('/me/stats', dashboardController.getMyStats);
router.get('/me/profile', dashboardController.getMyProfile);
router.get('/me/applications', hrApplicationController.listMyApplications);
router.patch('/me/profile', userProfileController.updateMyPublicProfile);
router.patch('/me/public-profile', userProfileController.updateMyPublicProfile);
router.get('/users/:userId/profile', userProfileController.getUserProfile);
router.patch(
  '/me/avatar',
  validateFiles({ required: ['avatar'], maxCount: 1, allowed: ['avatar'], checkDatabase: true }),
  dashboardController.updateMyAvatar
);
router.get('/committees/:committeeId/workspace', requireCommitteeScope('committeeId'), workspaceController.getCommitteeWorkspace);
router.post('/committees/:committeeId/tasks', requireCommitteeScope('committeeId'), taskController.createTask);
router.get('/committees/:committeeId/resources', requireCommitteeScope('committeeId'), resourceController.listCommitteeResources);
router.post('/committees/:committeeId/resources', requireCommitteeScope('committeeId'), resourceController.createCommitteeResource);
router.patch('/committees/:committeeId/resources/:resourceId', requireCommitteeScope('committeeId'), resourceController.updateCommitteeResource);
router.delete('/committees/:committeeId/resources/:resourceId', requireCommitteeScope('committeeId'), resourceController.deleteCommitteeResource);
router.get('/committees/memberships/all', membershipController.listAllMemberships);
router.get('/users/search', membershipController.searchRegisteredUsers);
router.get('/committees/:committeeId/memberships', membershipController.listCommitteeMemberships);
router.get('/committees/:committeeId/members', membershipController.searchCommitteeMembers);
router.post('/committees/:committeeId/memberships', membershipController.upsertCommitteeMembership);
router.delete('/committees/:committeeId/memberships/:userId', membershipController.removeCommitteeMembership);
router.get('/committees/:committeeId/announcements', requireCommitteeScope('committeeId'), committeeAnnouncementController.listCommitteeAnnouncements);
router.post('/committees/:committeeId/announcements', requireCommitteeScope('committeeId'), committeeAnnouncementController.createCommitteeAnnouncement);
router.patch('/committees/:committeeId/announcements/:announcementId/pin', requireCommitteeScope('committeeId'), committeeAnnouncementController.updateCommitteeAnnouncementPin);
router.delete('/committees/:committeeId/announcements/:announcementId', requireCommitteeScope('committeeId'), committeeAnnouncementController.deleteCommitteeAnnouncement);
router.get('/committees/:committeeId/assignments', requireCommitteeScope('committeeId'), assignmentController.listCommitteeAssignments);
router.post('/committees/:committeeId/assignments', requireCommitteeScope('committeeId'), assignmentController.createCommitteeAssignment);
router.patch('/committees/:committeeId/assignments/:assignmentId', requireCommitteeScope('committeeId'), assignmentController.updateCommitteeAssignment);
router.delete('/committees/:committeeId/assignments/:assignmentId', requireCommitteeScope('committeeId'), assignmentController.deleteCommitteeAssignment);
router.post('/committees/:committeeId/assignments/:assignmentId/submit', requireCommitteeScope('committeeId'), assignmentController.submitAssignment);
router.get('/committees/:committeeId/assignments/:assignmentId/submissions', requireCommitteeScope('committeeId'), assignmentController.listAssignmentSubmissions);
router.patch('/committees/:committeeId/assignments/:assignmentId/submissions/:submissionId/grade', requireCommitteeScope('committeeId'), assignmentController.gradeAssignmentSubmission);
router.patch('/tasks/:taskId', taskController.updateTask);
router.patch('/tasks/:taskId/status', taskController.updateTaskStatus);
router.patch('/tasks/:taskId/claim', taskController.claimTask);
router.patch('/tasks/:taskId/archive', taskController.archiveTask);
router.delete('/tasks/:taskId', taskController.deleteTask);
router.get('/hr/campaigns', hrCampaignController.listCampaigns);
router.get('/hr/campaigns/open', hrCampaignController.getOpenCampaigns);
router.post('/hr/campaigns', hrCampaignController.createCampaign);
router.patch('/hr/campaigns/:campaignId', hrCampaignController.updateCampaign);
router.patch('/hr/campaigns/:campaignId/status', hrCampaignController.updateCampaignStatus);
router.post('/hr/applications', hrApplicationController.createApplication);
router.get('/hr/applications', hrApplicationController.listApplications);
router.patch('/hr/applications/:applicationId/stage', hrApplicationController.updateApplicationStage);
router.post('/hr/applications/:applicationId/accept', hrApplicationController.acceptApplication);
router.post('/hr/applications/:applicationId/reject', hrApplicationController.rejectApplication);
router.post('/hr/applications/mark-welcome-sent', hrApplicationController.markWelcomeSent);
router.get('/hr/onboarding/candidates', hrApplicationController.listOnboardingCandidates);
router.get('/hr/onboarding/:userId', hrOnboardingController.listOnboardingByUser);
router.patch('/hr/onboarding/:itemId', hrOnboardingController.updateOnboardingItem);
router.get('/hr/reports/pipeline-summary', hrReportsController.getPipelineSummary);
router.get('/hr/reports/pipeline-timeline', hrReportsController.getPipelineTimeline);
router.post('/pr/announcements', prAnnouncementController.createAnnouncement);
router.get('/pr/announcements', prAnnouncementController.listAnnouncements);
router.patch('/pr/announcements/:announcementId', prAnnouncementController.updateAnnouncement);
router.patch('/pr/announcements/:announcementId/pin', prAnnouncementController.updateAnnouncement);
router.delete('/pr/announcements/:announcementId', prAnnouncementController.deleteAnnouncement);
router.post('/pr/campaigns', prCampaignController.createCampaign);
router.get('/pr/campaigns', prCampaignController.listCampaigns);
router.post('/pr/campaigns/recipients-preview', prCampaignController.previewRecipients);
router.put('/pr/campaigns/:campaignId', prCampaignController.updateCampaign);
router.patch('/pr/campaigns/:campaignId', prCampaignController.updateCampaign);
router.delete('/pr/campaigns/:campaignId', prCampaignController.deleteCampaign);
router.post('/pr/campaigns/:campaignId/archive', prCampaignController.archiveCampaign);
router.post('/pr/campaigns/:campaignId/unarchive', prCampaignController.unarchiveCampaign);
router.post('/pr/campaigns/:campaignId/duplicate', prCampaignController.duplicateCampaign);
router.post('/pr/campaigns/:campaignId/send', prCampaignController.sendCampaign);
router.get('/pr/campaigns/:campaignId/delivery', prCampaignController.getCampaignDelivery);
router.get('/pr/campaigns/:campaignId/delivery-logs', prCampaignController.getCampaignDelivery);

// Media Studio & Brand Asset Repository
router.get('/media/stats', mediaAlbumController.getMediaStats);
router.post('/media/albums', mediaAlbumController.createAlbum);
router.get('/media/albums', mediaAlbumController.listAlbums);
router.get('/media/albums/:albumId', mediaAlbumController.getAlbum);
router.patch('/media/albums/:albumId', mediaAlbumController.updateAlbum);
router.delete('/media/albums/:albumId', mediaAlbumController.deleteAlbum);
router.post('/media/albums/:albumId/assets', mediaAlbumController.addAlbumAsset);
router.delete('/media/albums/:albumId/assets/:assetId', mediaAlbumController.deleteAlbumAsset);
router.post('/media/albums/:albumId/publish', mediaAlbumController.publishAlbum);
router.post('/media/albums/:albumId/unpublish', mediaAlbumController.unpublishAlbum);
router.post('/media/coverage-requests', mediaCoverageController.createCoverageRequest);
router.patch('/media/coverage-requests/:requestId/status', mediaCoverageController.updateCoverageStatus);

// Brand & Design Kit Assets
router.get('/media/brand-assets', mediaBrandAssetController.listBrandAssets);
router.post('/media/brand-assets', mediaBrandAssetController.createBrandAsset);
router.patch('/media/brand-assets/:assetId', mediaBrandAssetController.updateBrandAsset);
router.delete('/media/brand-assets/:assetId', mediaBrandAssetController.deleteBrandAsset);

router.post('/admin/officers', officerAdminController.createOfficer);
router.patch('/admin/officers/:id', officerAdminController.updateOfficer);
router.delete('/admin/officers/:id', officerAdminController.deleteOfficer);
router.get('/routes', routesController.getCoreRoutes);

module.exports = router;
