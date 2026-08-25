const config = require('../config');
const { resolveIdentity } = require('../middlewares/authenticate');
const { buildCoreGatewayHeaders, buildEventClaimsHeaders } = require('../utils/signer');

async function proxyToCore(req, res, next) {
  const identity = resolveIdentity(req);
  const rawTargetPath = req.originalUrl.replace('/api/core', '') || '/';

  let normalizedPath = rawTargetPath;
  if (rawTargetPath.startsWith('/public')) {
    normalizedPath = rawTargetPath;
  } else if (!rawTargetPath.startsWith('/core') && !rawTargetPath.startsWith('/public')) {
    normalizedPath = `/core${rawTargetPath.startsWith('/') ? '' : '/'}${rawTargetPath}`;
  }

  const targetUrl = `${config.corePlatformUrl}${normalizedPath}`;
  const signedHeaders = buildCoreGatewayHeaders(
    req.method,
    normalizedPath,
    identity,
    config.gatewaySharedSecret
  );

  try {
    const forwardHeaders = {
      ...signedHeaders,
      'content-type': req.headers['content-type'] || 'application/json',
      'user-agent': req.headers['user-agent'] || 'IEEE-Portal-Gateway/1.0',
    };

    if (req.headers['x-service-token']) {
      forwardHeaders['x-service-token'] = req.headers['x-service-token'];
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && Object.keys(req.body || {}).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    res.status(response.status);
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.json(data);
    } else {
      const text = await response.text();
      return res.send(text);
    }
  } catch (err) {
    console.error(`[Gateway Proxy Error -> Core Platform] ${targetUrl}:`, err.message);
    return res.status(502).json({ error: 'Core Platform service unavailable', details: err.message });
  }
}

async function proxyToEvents(req, res, next) {
  const identity = resolveIdentity(req);
  const rawTargetPath = req.originalUrl.replace(/^\/api\/events/, '') || '';

  let fullApiPath;
  if (rawTargetPath === '' || rawTargetPath === '/') {
    fullApiPath = '/api/v1/events';
  } else if (rawTargetPath.startsWith('/admin') || rawTargetPath.startsWith('/health')) {
    fullApiPath = `/api/v1${rawTargetPath}`;
  } else {
    fullApiPath = `/api/v1/events${rawTargetPath.startsWith('/') ? '' : '/'}${rawTargetPath}`;
  }

  const targetUrl = `${config.eventRegisterUrl}${fullApiPath}`;

  const signedClaimsHeaders = buildEventClaimsHeaders(
    identity,
    config.claimsHmacSecret
  );

  try {
    const forwardHeaders = {
      ...signedClaimsHeaders,
      'content-type': req.headers['content-type'] || 'application/json',
      'user-agent': req.headers['user-agent'] || 'IEEE-Portal-Gateway/1.0',
    };

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && Object.keys(req.body || {}).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    res.status(response.status);
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.json(data);
    } else {
      const text = await response.text();
      return res.send(text);
    }
  } catch (err) {
    console.error(`[Gateway Proxy Error -> Event Register] ${targetUrl}:`, err.message);
    return res.status(502).json({ error: 'Event Register service unavailable', details: err.message });
  }
}

async function proxyToFiles(req, res, next) {
  const identity = resolveIdentity(req);
  const targetPath = req.originalUrl;
  const targetUrl = `${config.fileServiceUrl}${targetPath}`;

  const signedHeaders = buildCoreGatewayHeaders(
    req.method,
    targetPath,
    identity,
    config.gatewaySharedSecret
  );

  try {
    const forwardHeaders = {
      ...signedHeaders,
      'content-type': req.headers['content-type'] || 'application/json',
      'user-agent': req.headers['user-agent'] || 'IEEE-Portal-Gateway/1.0',
    };

    if (req.headers.authorization) {
      forwardHeaders['authorization'] = req.headers.authorization;
    }

    let bodyData = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        bodyData = Buffer.concat(chunks);
      } else if (Object.keys(req.body || {}).length > 0) {
        bodyData = JSON.stringify(req.body);
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      body: bodyData,
    };

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    res.status(response.status);
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.json(data);
    } else {
      const text = await response.text();
      return res.send(text);
    }
  } catch (err) {
    console.error(`[Gateway Proxy Error -> File Service] ${targetUrl}:`, err.message);
    return res.status(502).json({ error: 'File Service unavailable', details: err.message });
  }
}

module.exports = {
  proxyToCore,
  proxyToEvents,
  proxyToFiles,
};
