const { randomUUID } = require('node:crypto');

const config = require('../config');
const logger = require('../utils/logger');

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const notificationConfig = config.notification || {};

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

function getEmailSendUrl() {
  if (!notificationConfig.emailServiceUrl) return null;
  const baseUrl = notificationConfig.emailServiceUrl.endsWith('/')
    ? notificationConfig.emailServiceUrl
    : `${notificationConfig.emailServiceUrl}/`;
  return new URL('email/send', baseUrl).toString();
}

function isEnabled() {
  return Boolean(notificationConfig.emailServiceUrl && notificationConfig.emailServiceAuthToken);
}

function formatDueAt(dueAt) {
  if (!dueAt) return null;
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) {
    return String(dueAt);
  }
  return parsed.toISOString();
}

function buildTaskAssignmentText({
  committeeName,
  taskTitle,
  taskDescription,
  taskDueAt,
  actorExternalUserId,
}) {
  const lines = [
    `Committee: ${committeeName}`,
    `Task: ${taskTitle}`,
  ];

  if (taskDescription) {
    lines.push(`Description: ${taskDescription}`);
  }

  const dueAt = formatDueAt(taskDueAt);
  if (dueAt) {
    lines.push(`Due at: ${dueAt}`);
  }

  lines.push(`Assigned by: ${actorExternalUserId}`);
  return lines.join('\n');
}

function buildAnnouncementText({
  committeeName,
  announcementTitle,
  announcementBody,
  actorExternalUserId,
}) {
  const lines = [
    `Committee: ${committeeName}`,
    `Announcement: ${announcementTitle}`,
    `Body: ${announcementBody}`,
    `Created by: ${actorExternalUserId}`,
  ];

  return lines.join('\n');
}

function buildPayload({ recipientEmail, subject, text, eventType, idempotencyKey }) {
  return {
    schemaVersion: '1.0',
    correlationId: randomUUID(),
    idempotencyKey,
    eventType,
    to: [recipientEmail],
    subject,
    text,
    createdAt: new Date().toISOString(),
  };
}

async function postEmail(payload, context) {
  const emailSendUrl = getEmailSendUrl();
  if (!isEnabled() || !emailSendUrl) {
    return { ok: false, reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timeoutMs = notificationConfig.emailServiceTimeoutMs || 3000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(emailSendUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': notificationConfig.emailServiceAuthToken,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      logger.warn({
        event: 'core.email_notification.failed',
        requestId: context.requestId,
        route: context.route,
        notificationType: context.notificationType,
        recipient: context.recipientEmail,
        idempotencyKey: payload.idempotencyKey,
        statusCode: response.status,
        responseBody: responseText.slice(0, 256),
      }, 'Email notification service returned non-2xx status');
      return { ok: false, reason: 'downstream_non_2xx', statusCode: response.status };
    }

    logger.info({
      event: 'core.email_notification.sent',
      requestId: context.requestId,
      route: context.route,
      notificationType: context.notificationType,
      recipient: context.recipientEmail,
      idempotencyKey: payload.idempotencyKey,
    }, 'Email notification sent');

    return { ok: true, statusCode: response.status };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
    logger.warn({
      event: 'core.email_notification.failed',
      requestId: context.requestId,
      route: context.route,
      notificationType: context.notificationType,
      recipient: context.recipientEmail,
      idempotencyKey: payload.idempotencyKey,
      reason,
      message: error?.message,
    }, 'Email notification request failed');
    return { ok: false, reason };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function sendTaskAssignmentNotification({
  requestId,
  route,
  committeeName,
  taskId,
  taskTitle,
  taskDescription,
  taskDueAt,
  assigneeExternalUserId,
  assigneeEmail,
  actorExternalUserId,
}) {
  if (!isEnabled()) {
    return { ok: false, reason: 'not_configured' };
  }

  const normalizedRecipient = normalizeEmail(assigneeEmail);
  if (!normalizedRecipient) {
    return { ok: false, reason: 'invalid_recipient', recipientEmail: assigneeEmail || null };
  }

  const payload = buildPayload({
    recipientEmail: normalizedRecipient,
    subject: `[${committeeName}] New task assigned: ${taskTitle}`,
    text: buildTaskAssignmentText({
      committeeName,
      taskTitle,
      taskDescription,
      taskDueAt,
      actorExternalUserId,
    }),
    eventType: 'core.task.assigned',
    idempotencyKey: `core-task-assigned:${taskId}:${assigneeExternalUserId}`,
  });

  const result = await postEmail(payload, {
    requestId,
    route,
    notificationType: 'task_assignment',
    recipientEmail: normalizedRecipient,
  });

  return { ...result, recipientEmail: normalizedRecipient };
}

async function sendCommitteeAnnouncementNotifications({
  requestId,
  route,
  committeeName,
  announcementId,
  announcementTitle,
  announcementBody,
  actorExternalUserId,
  actorEmail,
  recipientEmails,
}) {
  if (!isEnabled()) {
    return {
      ok: false,
      reason: 'not_configured',
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalRecipients: 0,
    };
  }

  const recipients = [];
  const seen = new Set();
  let invalidRecipientCount = 0;

  const sourceEmails = Array.isArray(recipientEmails) ? [...recipientEmails, actorEmail] : [actorEmail];
  for (const candidate of sourceEmails) {
    const normalized = normalizeEmail(candidate);
    if (!normalized) {
      invalidRecipientCount += 1;
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    recipients.push(normalized);
  }

  if (!recipients.length) {
    logger.warn({
      event: 'core.email_notification.skipped',
      requestId,
      route,
      notificationType: 'committee_announcement',
      reason: 'no_valid_recipients',
    }, 'Skipping committee announcement notifications because no valid recipients were resolved');

    return {
      ok: false,
      reason: 'no_valid_recipients',
      sentCount: 0,
      failedCount: 0,
      skippedCount: invalidRecipientCount,
      totalRecipients: 0,
    };
  }

  if (invalidRecipientCount > 0) {
    logger.warn({
      event: 'core.email_notification.skipped',
      requestId,
      route,
      notificationType: 'committee_announcement',
      reason: 'invalid_recipient',
      invalidRecipientCount,
    }, 'Some committee announcement recipients were skipped because of invalid email addresses');
  }

  const results = await Promise.all(recipients.map(async (recipientEmail) => {
    const payload = buildPayload({
      recipientEmail,
      subject: `[${committeeName}] New announcement: ${announcementTitle}`,
      text: buildAnnouncementText({
        committeeName,
        announcementTitle,
        announcementBody,
        actorExternalUserId,
      }),
      eventType: 'core.committee.announcement.created',
      idempotencyKey: `core-announcement:${announcementId}:${recipientEmail}`,
    });

    const result = await postEmail(payload, {
      requestId,
      route,
      notificationType: 'committee_announcement',
      recipientEmail,
    });

    return { ...result, recipientEmail };
  }));

  const sentCount = results.filter((item) => item.ok).length;
  const failedCount = results.length - sentCount;

  return {
    ok: failedCount === 0,
    reason: failedCount > 0 ? 'partial_failure' : null,
    sentCount,
    failedCount,
    skippedCount: invalidRecipientCount,
    totalRecipients: results.length,
    results,
  };
}

module.exports = {
  isEnabled,
  sendTaskAssignmentNotification,
  sendCommitteeAnnouncementNotifications,
};
