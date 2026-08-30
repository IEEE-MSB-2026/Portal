const { randomUUID } = require('node:crypto');

const config = require('../config');
const logger = require('../utils/logger');

const iamConfig = config.iam || {};

function getAssignRoleUrl() {
  if (!iamConfig.serviceUrl) return null;

  const baseUrl = iamConfig.serviceUrl.endsWith('/')
    ? iamConfig.serviceUrl
    : `${iamConfig.serviceUrl}/`;

  return new URL('admin/roles/assign', baseUrl).toString();
}

function getRevokeRoleUrl() {
  if (!iamConfig.serviceUrl) return null;

  const baseUrl = iamConfig.serviceUrl.endsWith('/')
    ? iamConfig.serviceUrl
    : `${iamConfig.serviceUrl}/`;

  return new URL('admin/roles/revoke', baseUrl).toString();
}

function isEnabled() {
  return Boolean(iamConfig.serviceUrl && iamConfig.serviceAuthToken);
}

function buildIdempotencyKey({ applicationId, applicantExternalUserId, committeeId }) {
  return `core-hr-accept:${applicationId}:${applicantExternalUserId}:${committeeId}:member`;
}

function buildPayload({ applicationId, applicantExternalUserId, committeeId }) {
  return {
    schemaVersion: '1.0',
    correlationId: randomUUID(),
    idempotencyKey: buildIdempotencyKey({ applicationId, applicantExternalUserId, committeeId }),
    userId: applicantExternalUserId,
    role: 'member',
    scopeType: 'committee',
    scopeId: committeeId,
    createdAt: new Date().toISOString(),
  };
}

async function assignCommitteeMemberRole({
  requestId,
  route,
  applicationId,
  applicantExternalUserId,
  committeeId,
}) {
  const assignRoleUrl = getAssignRoleUrl();
  if (!isEnabled() || !assignRoleUrl) {
    return {
      ok: false,
      reason: 'not_configured',
      statusCode: 503,
    };
  }

  const payload = buildPayload({
    applicationId,
    applicantExternalUserId,
    committeeId,
  });

  const controller = new AbortController();
  const timeoutMs = iamConfig.serviceTimeoutMs || 3000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(assignRoleUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': iamConfig.serviceAuthToken,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn({
        event: 'core.iam_assignment.failed',
        requestId,
        route,
        applicationId,
        committeeId,
        applicantUserId: applicantExternalUserId,
        idempotencyKey: payload.idempotencyKey,
        statusCode: response.status,
      }, 'IAM role assignment returned non-2xx status');

      return {
        ok: false,
        reason: 'downstream_non_2xx',
        statusCode: 502,
      };
    }

    logger.info({
      event: 'core.iam_assignment.succeeded',
      requestId,
      route,
      applicationId,
      committeeId,
      applicantUserId: applicantExternalUserId,
      idempotencyKey: payload.idempotencyKey,
    }, 'IAM role assignment succeeded');

    return {
      ok: true,
      statusCode: response.status,
      idempotencyKey: payload.idempotencyKey,
    };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
    logger.warn({
      event: 'core.iam_assignment.failed',
      requestId,
      route,
      applicationId,
      committeeId,
      applicantUserId: applicantExternalUserId,
      idempotencyKey: payload.idempotencyKey,
      reason,
      message: error?.message,
    }, 'IAM role assignment request failed');

    return {
      ok: false,
      reason,
      statusCode: 502,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function syncRoleAssignment({ userId, role, scopeType = 'committee', scopeId = null }) {
  const assignRoleUrl = getAssignRoleUrl();
  if (!isEnabled() || !assignRoleUrl) return { ok: false, reason: 'not_configured' };

  try {
    const response = await fetch(assignRoleUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': iamConfig.serviceAuthToken,
      },
      body: JSON.stringify({
        userId,
        role,
        scopeType,
        scopeId,
      }),
    });
    return { ok: response.ok, statusCode: response.status };
  } catch (err) {
    logger.warn({ event: 'core.iam_sync.assign_failed', userId, role, scopeId, err: err.message });
    return { ok: false, reason: err.message };
  }
}

async function syncRoleRevocation({ userId, scopeType = 'committee', scopeId = null }) {
  const revokeRoleUrl = getRevokeRoleUrl();
  if (!isEnabled() || !revokeRoleUrl) return { ok: false, reason: 'not_configured' };

  try {
    const response = await fetch(revokeRoleUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': iamConfig.serviceAuthToken,
      },
      body: JSON.stringify({
        userId,
        scopeType,
        scopeId,
      }),
    });
    return { ok: response.ok, statusCode: response.status };
  } catch (err) {
    logger.warn({ event: 'core.iam_sync.revoke_failed', userId, scopeId, err: err.message });
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  assignCommitteeMemberRole,
  syncRoleAssignment,
  syncRoleRevocation,
  buildIdempotencyKey,
  isEnabled,
};
