const { randomUUID } = require('crypto');
const prCampaignsRepository = require('../repositories/prCampaignsRepository');
const emailNotificationService = require('./emailNotificationService');

/**
 * Interpolates dot-notation template tags: {{user.name}}, {{user.email}}, {{user.committee}}, {{sheet.Column}}, etc.
 */
function renderTemplate(templateString, context = {}) {
  if (!templateString || typeof templateString !== 'string') return '';

  return templateString.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const rawKey = key.trim();
    const lowerKey = rawKey.toLowerCase();

    // 1. Direct matches in context
    if (context[rawKey] !== undefined && context[rawKey] !== null && context[rawKey] !== '') {
      return String(context[rawKey]);
    }
    if (context[lowerKey] !== undefined && context[lowerKey] !== null && context[lowerKey] !== '') {
      return String(context[lowerKey]);
    }

    // 2. Custom sheet fields
    if (context.customFields && typeof context.customFields === 'object') {
      if (context.customFields[rawKey] !== undefined && context.customFields[rawKey] !== null) {
        return String(context.customFields[rawKey]);
      }
      if (context.customFields[lowerKey] !== undefined && context.customFields[lowerKey] !== null) {
        return String(context.customFields[lowerKey]);
      }
      if (lowerKey.startsWith('sheet.')) {
        const subKey = rawKey.slice(6);
        if (context.customFields[subKey] !== undefined && context.customFields[subKey] !== null) {
          return String(context.customFields[subKey]);
        }
      }
    }

    // 3. Standard aliases with fallback defaults
    if (lowerKey === 'user.name' || lowerKey === 'name') {
      return context.name || 'Member';
    }
    if (lowerKey === 'user.email' || lowerKey === 'email') {
      return context.email || '';
    }
    if (lowerKey === 'user.committee' || lowerKey === 'committee' || lowerKey === 'committeename') {
      return context.committeeName || 'IEEE Menoufia SB';
    }
    if (lowerKey === 'user.role' || lowerKey === 'role') {
      return context.role || 'Member';
    }

    return match;
  });
}

/**
 * Builds responsive IEEE Menoufia branded HTML email
 */
function formatEmailHtml({ title, body, recipientName, committeeName }) {
  const trimmed = (body || '').trim();
  if (trimmed.toLowerCase().startsWith('<!doctype') || trimmed.toLowerCase().startsWith('<html')) {
    return trimmed;
  }

  let contentHtml = body;
  const isHtml = /<[a-z][\s\S]*>/i.test(body);

  if (!isHtml) {
    contentHtml = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[(.*?)\]\((https?:\/\/[^\s]+)\)/g, '<a href="$2" style="color:#00629b;text-decoration:underline;" target="_blank">$1</a>')
      .replace(/\n\n/g, '</p><p style="margin:0 0 16px;line-height:1.65;color:#334155;">')
      .replace(/\n/g, '<br/>');
    contentHtml = `<p style="margin:0 0 16px;line-height:1.65;color:#334155;">${contentHtml}</p>`;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:24px 12px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);border:1px solid #e2e8f0;">
    <!-- Header -->
    <tr>
      <td style="background:linear-gradient(135deg, #002855 0%, #00629b 100%);padding:28px 24px;text-align:center;">
        <h1 style="margin:0;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">IEEE Menoufia Student Branch</h1>
        <p style="margin:6px 0 0;font-size:13px;color:#93c5fd;font-weight:500;">Official Communications & Outreach</p>
      </td>
    </tr>
    <!-- Content Body -->
    <tr>
      <td style="padding:32px 28px;">
        <div style="font-size:15px;line-height:1.65;color:#1e293b;">
          ${contentHtml}
        </div>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background:#f1f5f9;padding:20px 24px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#64748b;line-height:1.5;">
        <div style="font-weight:600;color:#475569;margin-bottom:4px;">
          &copy; 2026 IEEE Menoufia Student Branch &bull; Menoufia University.
        </div>
        <div style="margin-top:8px;font-size:11px;color:#64748b;">
          sent via IEEE MSB Portal &bull; All Rights Reserved.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

async function dispatchCampaign({
  requestId,
  route,
  campaign,
  maxRecipients = 1000,
}) {
  const dispatchRequestId = randomUUID();

  // Parse recipient user IDs or custom sheet array if present
  let recipientUserIds = [];
  let customRecipients = [];
  try {
    if (typeof campaign.recipient_user_ids === 'string') {
      recipientUserIds = JSON.parse(campaign.recipient_user_ids);
    } else if (Array.isArray(campaign.recipient_user_ids)) {
      recipientUserIds = campaign.recipient_user_ids;
    }
  } catch {
    recipientUserIds = [];
  }

  try {
    if (typeof campaign.custom_recipients === 'string') {
      customRecipients = JSON.parse(campaign.custom_recipients);
    } else if (Array.isArray(campaign.custom_recipients)) {
      customRecipients = campaign.custom_recipients;
    }
  } catch {
    customRecipients = [];
  }

  // Resolve rich recipient objects
  const rawRecipients = await prCampaignsRepository.listRecipientsForSegment({
    segmentType: campaign.segment_type,
    committeeId: campaign.committee_id,
    recipientUserIds,
    customRecipients,
  });

  // Deduplicate and build interpolated payloads per recipient
  const seenEmails = new Set();
  const personalizedRecipients = [];

  for (const r of rawRecipients) {
    if (!r.email) continue;
    const cleanEmail = r.email.trim().toLowerCase();
    if (seenEmails.has(cleanEmail)) continue;
    seenEmails.add(cleanEmail);

    const interpSubject = renderTemplate(campaign.subject, r);
    const interpBody = renderTemplate(campaign.body, r);
    const htmlBody = formatEmailHtml({
      title: interpSubject,
      body: interpBody,
      recipientName: r.name,
      committeeName: r.committeeName,
    });

    personalizedRecipients.push({
      email: cleanEmail,
      name: r.name,
      subject: interpSubject,
      text: interpBody,
      html: htmlBody,
    });
  }

  if (personalizedRecipients.length > maxRecipients) {
    return {
      ok: false,
      reason: 'max_recipients_exceeded',
      statusCode: 400,
      dispatchRequestId,
      recipientCount: personalizedRecipients.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      logs: [],
    };
  }

  const notification = await emailNotificationService.sendPrCampaignDispatchNotifications({
    requestId,
    route,
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    subject: campaign.subject,
    campaignBody: campaign.body,
    recipients: personalizedRecipients,
  });

  const detailedLogs = (notification.results || []).map((res) => ({
    email: res.recipientEmail,
    name: res.name || 'Member',
    status: res.ok ? 'sent' : 'failed',
    error: res.ok ? null : (res.reason || 'delivery_failed'),
    statusCode: res.statusCode || null,
    sentAt: res.sentAt || new Date().toISOString(),
  }));

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
      logs: detailedLogs,
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
    logs: detailedLogs,
  };
}

module.exports = {
  dispatchCampaign,
  renderTemplate,
  formatEmailHtml,
};
