const config = require('../config');

/**
 * Checks if a candidate URL has an allowed origin according to security policy.
 * @param {string} rawUrl - Candidate origin or URL.
 * @returns {string|null} Normalized origin (e.g. 'https://portal.ieeemsb.org') or null if invalid/disallowed.
 */
function validateOrigin(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const origin = parsed.origin;
    const hostname = parsed.hostname.toLowerCase();

    // 1. In non-production, localhost and 127.0.0.1 are allowed
    if (process.env.NODE_ENV !== 'production') {
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return origin;
      }
    }

    // 2. Check exact match against configured frontendUrl
    if (config.frontendUrl) {
      try {
        const configuredOrigin = new URL(config.frontendUrl).origin;
        if (origin.toLowerCase() === configuredOrigin.toLowerCase()) {
          return origin;
        }
      } catch (_) {}
    }

    // 3. Check against CORS_ORIGIN entries
    if (config.corsOrigin && config.corsOrigin !== '*') {
      const allowedOrigins = config.corsOrigin
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      for (const allowed of allowedOrigins) {
        try {
          if (origin.toLowerCase() === new URL(allowed).origin.toLowerCase()) {
            return origin;
          }
        } catch (_) {
          if (hostname === allowed) {
            return origin;
          }
        }
      }
    }

    // 4. Match official IEEE Menoufia and Vercel domains (production & preview deployments)
    const isOfficialDomain =
      hostname === 'ieeemsb.org' ||
      hostname.endsWith('.ieeemsb.org') ||
      hostname === 'vercel.app' ||
      hostname.endsWith('.vercel.app');

    if (isOfficialDomain) {
      return origin;
    }

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolves the portal base URL for outbound email links.
 * Prioritizes dynamic client origin (Origin / Referer / clientUrl / redirectUrl) if valid,
 * falling back to configured FRONTEND_URL or default.
 * @param {import('express').Request} [req]
 * @returns {string}
 */
function resolvePortalBaseUrl(req) {
  const fallback =
    config.frontendUrl ||
    process.env.FRONTEND_URL ||
    process.env.PORTAL_BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://portal.ieeemsb.org'
      : 'http://localhost:5173');

  if (!req) return fallback;

  const candidate =
    req.headers?.origin ||
    req.headers?.referer ||
    req.body?.clientUrl ||
    req.body?.redirectUrl ||
    req.query?.clientUrl ||
    req.query?.redirectUrl;

  const validated = validateOrigin(candidate);
  return validated || fallback;
}

module.exports = {
  validateOrigin,
  resolvePortalBaseUrl,
};
