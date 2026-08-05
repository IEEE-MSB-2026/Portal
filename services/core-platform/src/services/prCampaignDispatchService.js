const { randomUUID } = require('crypto');

const prCampaignsRepository = require('../repositories/prCampaignsRepository');
const emailNotificationService = require('./emailNotificationService');

function normalizeRecipientList(recipientEmails) {
  const seen = new Set();
  const normalized = [];
  for (const email of recipientEmails || []) {
    if (typeof email !== 'string') continue;
    const candidate = email.trim().toLowerCase();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

async function dispatchCampaign({
  requestId,
  route,
  campaign,
  maxRecipients,
}) {
  const dispatchRequestId = randomUUID();
  const resolvedRecipients = await prCampaignsRepository.listRecipientEmailsForSegment({
    segmentType: campaign.segment_type,
    committeeId: campaign.committee_id,
  });
  const recipients = normalizeRecipientList(resolvedRecipients);

  if (recipients.length > maxRecipients) {
    return {
      ok: false,
      reason: 'max_recipients_exceeded',
      statusCode: 400,
      dispatchRequestId,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };
  }

  const notification = await emailNotificationService.sendPrCampaignDispatchNotifications({
    requestId,
    route,
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    subject: campaign.subject,
    campaignBody: campaign.body,
    recipientEmails: recipients,
  });

  if (!notification.ok) {
    return {
      ok: false,
      reason: notification.reason,
      statusCode: notification.reason === 'not_configured' ? 503 : 502,
      dispatchRequestId,
      recipientCount: notification.totalRecipients,
      sentCount: notification.sentCount,
      failedCount: notification.failedCount,
      skippedCount: notification.skippedCount,
    };
  }

  return {
    ok: true,
    reason: notification.reason,
    statusCode: 200,
    dispatchRequestId,
    recipientCount: notification.totalRecipients,
    sentCount: notification.sentCount,
    failedCount: notification.failedCount,
    skippedCount: notification.skippedCount,
  };
}

module.exports = {
  dispatchCampaign,
};
