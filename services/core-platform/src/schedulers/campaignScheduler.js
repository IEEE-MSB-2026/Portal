const logger = require('../utils/logger');
const prCampaignsRepository = require('../repositories/prCampaignsRepository');
const prCampaignDispatchService = require('../services/prCampaignDispatchService');

let schedulerTimer = null;
let isPolling = false;

async function pollAndDispatchDueCampaigns() {
  if (isPolling) return;
  isPolling = true;

  try {
    const claimedCampaigns = await prCampaignsRepository.claimDueScheduledCampaigns({ limit: 10 });
    if (!claimedCampaigns || claimedCampaigns.length === 0) {
      return;
    }

    logger.info({
      event: 'pr.campaign.scheduler.claimed',
      count: claimedCampaigns.length,
    }, `Claimed ${claimedCampaigns.length} due scheduled PR campaigns for dispatch`);

    for (const campaign of claimedCampaigns) {
      try {
        const dispatch = await prCampaignDispatchService.dispatchCampaign({
          requestId: `scheduler-${campaign.id}`,
          route: '/schedulers/pr-campaigns',
          campaign,
          maxRecipients: 5000,
        });

        if (dispatch.ok) {
          await prCampaignsRepository.markCampaignSent({
            campaignId: campaign.id,
            dispatchRequestId: dispatch.dispatchRequestId,
            recipientCount: dispatch.recipientCount,
            sentCount: dispatch.sentCount,
            failedCount: dispatch.failedCount,
            actorUserId: campaign.created_by_user_id,
          });

          await prCampaignsRepository.createDispatchLog({
            campaignId: campaign.id,
            dispatchRequestId: dispatch.dispatchRequestId,
            status: 'sent',
            recipientCount: dispatch.recipientCount,
            sentCount: dispatch.sentCount,
            failedCount: dispatch.failedCount,
            error: null,
            logs: dispatch.logs || [],
          });

          logger.info({
            event: 'pr.campaign.scheduler.sent',
            campaignId: campaign.id,
            recipientCount: dispatch.recipientCount,
            sentCount: dispatch.sentCount,
          }, `Scheduled campaign ${campaign.id} successfully dispatched`);
        } else {
          await prCampaignsRepository.markCampaignFailed({
            campaignId: campaign.id,
            dispatchRequestId: dispatch.dispatchRequestId,
            recipientCount: dispatch.recipientCount,
            sentCount: dispatch.sentCount,
            failedCount: dispatch.failedCount,
            error: dispatch.reason,
            actorUserId: campaign.created_by_user_id,
          });

          await prCampaignsRepository.createDispatchLog({
            campaignId: campaign.id,
            dispatchRequestId: dispatch.dispatchRequestId,
            status: 'failed',
            recipientCount: dispatch.recipientCount,
            sentCount: dispatch.sentCount,
            failedCount: dispatch.failedCount,
            error: dispatch.reason,
            logs: dispatch.logs || [],
          });

          logger.warn({
            event: 'pr.campaign.scheduler.failed',
            campaignId: campaign.id,
            reason: dispatch.reason,
          }, `Scheduled campaign ${campaign.id} dispatch failed`);
        }
      } catch (err) {
        logger.error({
          event: 'pr.campaign.scheduler.error',
          campaignId: campaign.id,
          err,
        }, `Error processing scheduled campaign ${campaign.id}`);
      }
    }
  } catch (error) {
    logger.error({
      event: 'pr.campaign.scheduler.poll_error',
      error: error?.message,
    }, 'Failed during campaign scheduler polling cycle');
  } finally {
    isPolling = false;
  }
}

function startCampaignScheduler(intervalMs = 60000) {
  if (schedulerTimer) return;

  logger.info({ event: 'pr.campaign.scheduler.started', intervalMs }, 'Starting PR campaign scheduler daemon');
  // Initial check shortly after startup
  setTimeout(() => {
    pollAndDispatchDueCampaigns().catch(() => {});
  }, 5000);

  schedulerTimer = setInterval(() => {
    pollAndDispatchDueCampaigns().catch(() => {});
  }, intervalMs);

  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }
}

function stopCampaignScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info({ event: 'pr.campaign.scheduler.stopped' }, 'Stopped PR campaign scheduler daemon');
  }
}

module.exports = {
  startCampaignScheduler,
  stopCampaignScheduler,
  pollAndDispatchDueCampaigns,
};
