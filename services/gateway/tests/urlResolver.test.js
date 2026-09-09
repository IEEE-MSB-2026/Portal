const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateOrigin, resolvePortalBaseUrl } = require('../src/utils/urlResolver');

describe('URL Resolver & Security Whitelist Tests', () => {
  test('validateOrigin allows official ieeemsb.org domains and subdomains', () => {
    assert.equal(validateOrigin('https://portal.ieeemsb.org'), 'https://portal.ieeemsb.org');
    assert.equal(validateOrigin('https://ieeemsb.org'), 'https://ieeemsb.org');
    assert.equal(validateOrigin('https://staging.portal.ieeemsb.org/login'), 'https://staging.portal.ieeemsb.org');
  });

  test('validateOrigin allows vercel.app preview and staging deployments', () => {
    assert.equal(validateOrigin('https://ieee-portal.vercel.app'), 'https://ieee-portal.vercel.app');
    assert.equal(validateOrigin('https://ieee-portal-pr-42.vercel.app/register'), 'https://ieee-portal-pr-42.vercel.app');
  });

  test('validateOrigin rejects unauthorized third-party and phishing domains', () => {
    assert.equal(validateOrigin('https://evil-phishing.com'), null);
    assert.equal(validateOrigin('https://ieeemsb.org.attacker.com'), null);
    assert.equal(validateOrigin('javascript:alert(1)'), null);
    assert.equal(validateOrigin('not-a-url'), null);
    assert.equal(validateOrigin(''), null);
    assert.equal(validateOrigin(null), null);
  });

  test('resolvePortalBaseUrl extracts and validates origin from request headers', () => {
    const reqWithOrigin = {
      headers: {
        origin: 'https://portal.ieeemsb.org',
      },
    };
    assert.equal(resolvePortalBaseUrl(reqWithOrigin), 'https://portal.ieeemsb.org');

    const reqWithReferer = {
      headers: {
        referer: 'https://ieee-portal.vercel.app/some-page',
      },
    };
    assert.equal(resolvePortalBaseUrl(reqWithReferer), 'https://ieee-portal.vercel.app');

    const reqWithClientUrl = {
      headers: {},
      body: {
        clientUrl: 'https://staging.portal.ieeemsb.org',
      },
    };
    assert.equal(resolvePortalBaseUrl(reqWithClientUrl), 'https://staging.portal.ieeemsb.org');
  });

  test('resolvePortalBaseUrl falls back to configured default when request origin is malicious', () => {
    const maliciousReq = {
      headers: {
        origin: 'https://malicious-token-stealer.xyz',
      },
    };
    const resolved = resolvePortalBaseUrl(maliciousReq);
    assert.notEqual(resolved, 'https://malicious-token-stealer.xyz');
    assert.ok(resolved.includes('ieeemsb.org') || resolved.includes('localhost'));
  });

  test('resolvePortalBaseUrl falls back to configured default when req is missing or empty', () => {
    const resolved = resolvePortalBaseUrl(null);
    assert.ok(resolved.length > 0);
  });
});
