const { randomUUID } = require('crypto');
const prCampaignsRepository = require('../repositories/prCampaignsRepository');
const hrApplicationsRepository = require('../repositories/hrApplicationsRepository');
const fileOutboxRepository = require('../repositories/fileOutboxRepository');
const emailNotificationService = require('./emailNotificationService');

/**
 * Hydrates attachments that have a remote URL into Base64 buffers required by email providers.
 */
async function hydrateAttachmentBuffers(attachments = [], urlCache = new Map()) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const hydrated = [];
  for (const att of attachments) {
    if (!att) continue;
    if (att.content || att.contentBase64) {
      hydrated.push({
        filename: att.filename || 'attachment.pdf',
        mimeType: att.mimeType || 'application/pdf',
        content: att.content || att.contentBase64,
        url: att.url || null,
        publicId: att.publicId || null,
        assetId: att.assetId || null,
      });
      continue;
    }
    if (att.url) {
      try {
        let base64Content;
        if (urlCache && urlCache.has(att.url)) {
          base64Content = urlCache.get(att.url);
        } else {
          const res = await fetch(att.url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
          }
          const arrayBuf = await res.arrayBuffer();
          base64Content = Buffer.from(arrayBuf).toString('base64');
          if (urlCache) {
            urlCache.set(att.url, base64Content);
          }
        }
        hydrated.push({
          filename: att.filename || 'attachment.pdf',
          mimeType: att.mimeType || 'application/pdf',
          content: base64Content,
          url: att.url,
          publicId: att.publicId || null,
          assetId: att.assetId || null,
        });
      } catch (err) {
        console.error(`Failed to hydrate attachment "${att.filename}" from ${att.url}:`, err.message);
        throw new Error(`Failed to load attachment "${att.filename}": ${err.message}`);
      }
    }
  }
  return hydrated;
}

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

function cleanEmptyEmailSections(html = '') {
  if (!html || typeof html !== 'string') return '';

  let cleaned = html;

  // 1. Remove <a> tags with empty, hash, null, or undefined href
  cleaned = cleaned.replace(/<a\b[^>]*\bhref=["'](?:#|undefined|null|)?["'][^>]*>[\s\S]*?<\/a>/gi, '');

  // 2. Remove CTA button container if it contains no <a> tags left
  cleaned = cleaned.replace(/<div\b[^>]*data-section=["']cta-buttons["'][^>]*>([\s\S]*?)<\/div>/gi, (match, inner) => {
    if (!/<a\b/i.test(inner)) {
      return '';
    }
    return match;
  });
  cleaned = cleaned.replace(/<div\b[^>]*style=["'][^"']*text-align:\s*center[^"']*["'][^>]*>\s*<\/div>/gi, '');

  // 3. Remove orientation block if date is empty or '—'
  cleaned = cleaned.replace(/<div\b[^>]*data-section=["']orientation["'][^>]*>([\s\S]*?)<\/div>/gi, (match, inner) => {
    const spanMatch = inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
    if (!spanMatch || !spanMatch[1] || !spanMatch[1].trim() || spanMatch[1].trim() === '—') {
      return '';
    }
    return match;
  });
  cleaned = cleaned.replace(/<div\b[^>]*style=["'][^"']*rgba\(0,\s*98,\s*155,\s*0\.07\)[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>\s*(?:—)?\s*<\/span>[\s\S]*?<\/div>/gi, '');

  // 4. Remove empty description spans
  cleaned = cleaned.replace(/<span\b[^>]*style=["'][^"']*color:\s*#64748b[^"']*["'][^>]*>\s*<\/span>/gi, '');

  // 5. Remove checklist rows with empty <strong> title
  cleaned = cleaned.replace(/<tr\b[^>]*>[\s\S]*?<strong\b[^>]*>\s*<\/strong>[\s\S]*?<\/tr>/gi, '');

  // 6. Re-number checklist badges sequentially (1, 2, 3...)
  let stepIndex = 1;
  cleaned = cleaned.replace(/(<tr\b[^>]*>[\s\S]*?<div\b[^>]*>)\s*\d+\s*(<\/div>[\s\S]*?<\/tr>)/gi, (match, before, after) => {
    return `${before}${stepIndex++}${after}`;
  });

  // 7. Remove checklist section if table has no <tr> rows left
  cleaned = cleaned.replace(/<div\b[^>]*data-section=["']checklist["'][^>]*>([\s\S]*?)<\/div>/gi, (match, inner) => {
    if (!/<tr\b/i.test(inner)) {
      return '';
    }
    return match;
  });
  cleaned = cleaned.replace(/<div\b[^>]*style=["'][^"']*margin-bottom:\s*24px[^"']*["'][^>]*>[\s\S]*?<table\b[^>]*>\s*<\/table>[\s\S]*?<\/div>/gi, '');

  return cleaned;
}

/**
 * Builds responsive IEEE Menoufia branded HTML email
 */
function formatEmailHtml({ title, body, recipientName, committeeName }) {
  const trimmed = (body || '').trim();
  if (trimmed.toLowerCase().startsWith('<!doctype') || trimmed.toLowerCase().startsWith('<html')) {
    return cleanEmptyEmailSections(trimmed);
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

  // Check for dynamic attachments configuration in campaign metadata
  let campaignMeta = {};
  try {
    if (typeof campaign.metadata === 'string') {
      campaignMeta = JSON.parse(campaign.metadata);
    } else if (typeof campaign.metadata === 'object' && campaign.metadata !== null) {
      campaignMeta = campaign.metadata;
    }
  } catch {
    campaignMeta = {};
  }

  const hasDynamicAttachments = Boolean(
    campaignMeta.hasDynamicAttachments ||
    campaignMeta.dynamicAttachmentsConfig
  );
  const skipUnmatched = Boolean(
    campaignMeta.dynamicAttachmentsConfig?.skipUnmatched ?? true
  );

  // Extract shared/common attachment (one attachment for all) if present
  const sharedAttachments = Array.isArray(campaignMeta.sharedAttachments)
    ? campaignMeta.sharedAttachments
    : (campaignMeta.sharedAttachment
        ? [campaignMeta.sharedAttachment]
        : (Array.isArray(campaignMeta.attachments) ? campaignMeta.attachments : []));

  // Deduplicate and build interpolated payloads per recipient
  const seenEmails = new Set();
  const personalizedRecipients = [];
  const skippedRecipients = [];
  const attachmentUrlCache = new Map();

  for (const r of rawRecipients) {
    if (!r.email) continue;
    const cleanEmail = r.email.trim().toLowerCase();
    if (seenEmails.has(cleanEmail)) continue;
    seenEmails.add(cleanEmail);

    const recipientDynamicAttachments = r.attachments || r.customFields?.attachments || [];

    // If campaign has dynamic attachments and user chose to skip recipients missing attachment
    if (hasDynamicAttachments && skipUnmatched && recipientDynamicAttachments.length === 0) {
      skippedRecipients.push({
        email: cleanEmail,
        name: r.name || 'Member',
        status: 'skipped',
        error: 'missing_attachment',
        statusCode: null,
        sentAt: new Date().toISOString(),
        attachments: [],
      });
      continue;
    }

    // Combine shared attachment (same for all) + dynamic attachments (personalized per recipient)
    const combinedRawAttachments = [...sharedAttachments, ...recipientDynamicAttachments];

    const interpSubject = renderTemplate(campaign.subject, r);
    const interpBody = renderTemplate(campaign.body, r);
    const htmlBody = formatEmailHtml({
      title: interpSubject,
      body: interpBody,
      recipientName: r.name,
      committeeName: r.committeeName,
    });

    const hydratedAttachments = await hydrateAttachmentBuffers(combinedRawAttachments, attachmentUrlCache);

    personalizedRecipients.push({
      email: cleanEmail,
      name: r.name,
      subject: interpSubject,
      text: interpBody,
      html: htmlBody,
      attachments: hydratedAttachments,
      participantId: r.participantId || r.customFields?.participantId || null,
    });
  }

  if (personalizedRecipients.length > maxRecipients) {
    return {
      ok: false,
      reason: 'max_recipients_exceeded',
      statusCode: 400,
      dispatchRequestId,
      recipientCount: personalizedRecipients.length + skippedRecipients.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: skippedRecipients.length,
      logs: skippedRecipients,
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

  const detailedLogs = [
    ...skippedRecipients,
    ...(notification.results || []).map((res) => ({
      email: res.recipientEmail,
      name: res.name || 'Member',
      status: res.ok ? 'sent' : 'failed',
      error: res.ok ? null : (res.reason || 'delivery_failed'),
      statusCode: res.statusCode || null,
      sentAt: res.sentAt || new Date().toISOString(),
      attachments: res.attachments || [],
    })),
  ];

  // Automatic cleanup of staged dynamic or shared attachments to preserve storage
  const hasStagedAttachments = hasDynamicAttachments || sharedAttachments.length > 0;
  if (hasStagedAttachments) {
    try {
      const filesToClean = [];
      // Clean shared attachments
      for (const a of sharedAttachments) {
        if (a && (a.assetId || a.publicId || a.url)) {
          filesToClean.push({
            fileAssetId: a.assetId || null,
            cloudinaryPublicId: a.publicId || null,
            secureUrl: a.url || null,
            resourceType: 'raw',
          });
        }
      }
      // Clean dynamic recipient attachments
      for (const r of rawRecipients) {
        const atts = r.attachments || r.customFields?.attachments || [];
        for (const a of atts) {
          if (a.assetId || a.publicId || a.url) {
            filesToClean.push({
              fileAssetId: a.assetId || null,
              cloudinaryPublicId: a.publicId || null,
              secureUrl: a.url || null,
              resourceType: 'raw',
            });
          }
        }
      }
      if (filesToClean.length > 0) {
        await fileOutboxRepository.queueBatchDeletions(filesToClean);
        const fileServiceUrl = process.env.FILE_SERVICE_URL || 'http://localhost:5080';
        fetch(`${fileServiceUrl}/cleanup/process-deletions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 100 }),
        }).catch(() => {});
      }
    } catch (cleanupErr) {
      console.warn('Failed to queue staged attachment cleanup post-dispatch:', cleanupErr.message);
    }
  }

  const totalSkipped = (notification.skippedCount || 0) + skippedRecipients.length;

  if (!notification.ok) {
    return {
      ok: false,
      reason: notification.reason,
      statusCode: notification.reason === 'not_configured' ? 503 : 502,
      dispatchRequestId,
      recipientCount: (notification.totalRecipients || 0) + skippedRecipients.length,
      sentCount: notification.sentCount,
      failedCount: notification.failedCount,
      skippedCount: totalSkipped,
      logs: detailedLogs,
    };
  }

  if (notification.ok && campaign.metadata) {
    try {
      let meta = campaign.metadata;
      if (typeof meta === 'string') meta = JSON.parse(meta);
      const isHrOutreach = meta?.category === 'hr_outreach' || meta?.source === 'hr_studio';
      if (isHrOutreach) {
        let appIds = Array.isArray(meta?.applicationIds) ? meta.applicationIds : [];
        if (appIds.length === 0 && Array.isArray(customRecipients)) {
          appIds = customRecipients
            .map((r) => r.applicationId || r.customFields?.applicationId)
            .filter(Boolean);
        }
        if (appIds.length > 0) {
          await hrApplicationsRepository.markWelcomeEmailsSent(appIds);
        }
      }

      const isTicketDispatch = meta?.category === 'event_ticket_dispatch' || meta?.source === 'operations_studio';
      if (isTicketDispatch && meta?.eventId) {
        let participantIds = (notification.results || [])
          .filter((res) => res.ok && res.participantId)
          .map((res) => res.participantId);

        if (participantIds.length === 0 && Array.isArray(meta?.participantIds)) {
          participantIds = meta.participantIds;
        }

        if (participantIds.length === 0 && Array.isArray(customRecipients)) {
          participantIds = customRecipients
            .map((r) => r.participantId || r.customFields?.participantId)
            .filter(Boolean);
        }

        if (participantIds.length > 0) {
          const eventRegisterUrl = process.env.EVENT_REGISTER_SERVICE_URL || process.env.EVENT_REGISTER_URL || 'http://localhost:5050';
          await fetch(`${eventRegisterUrl}/api/events/${meta.eventId}/qr/dispatch-callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participantIds }),
          }).catch((err) => {
            console.error('Failed to notify event-register dispatch callback:', err.message);
          });
        }
      }
    } catch {
      // Non-critical background hook
    }
  }

  return {
    ok: true,
    reason: notification.reason,
    statusCode: 200,
    dispatchRequestId,
    recipientCount: (notification.totalRecipients || 0) + skippedRecipients.length,
    sentCount: notification.sentCount,
    failedCount: notification.failedCount,
    skippedCount: totalSkipped,
    logs: detailedLogs,
  };
}

module.exports = {
  dispatchCampaign,
  renderTemplate,
  formatEmailHtml,
};
