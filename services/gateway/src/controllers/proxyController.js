const config = require('../config');
const { resolveIdentity } = require('../middlewares/authenticate');
const { buildCoreGatewayHeaders, buildEventClaimsHeaders } = require('../utils/signer');

async function proxyToCore(req, res, next) {
  let identity;
  try {
    identity = resolveIdentity(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Invalid or expired token' });
  }
  const rawTargetPath = req.originalUrl.replace('/api/core', '') || '/';

  const [pathOnly, queryString] = rawTargetPath.split('?');

  let normalizedPath = pathOnly;
  if (pathOnly.startsWith('/public')) {
    normalizedPath = pathOnly;
  } else if (!pathOnly.startsWith('/core') && !pathOnly.startsWith('/public')) {
    normalizedPath = `/core${pathOnly.startsWith('/') ? '' : '/'}${pathOnly}`;
  }

  const targetUrl = `${config.corePlatformUrl}${normalizedPath}${queryString ? `?${queryString}` : ''}`;
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

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && Object.keys(req.body || {}).length > 0) {
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
  let identity;
  try {
    identity = resolveIdentity(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Invalid or expired token' });
  }
  const [pathOnly, queryString] = (req.originalUrl.replace(/^\/api\/events/, '') || '').split('?');

  let fullApiPath;
  if (pathOnly === '' || pathOnly === '/') {
    fullApiPath = '/api/v1/events';
  } else if (pathOnly.startsWith('/admin') || pathOnly.startsWith('/health') || pathOnly.startsWith('/activities')) {
    fullApiPath = `/api/v1${pathOnly}`;
  } else {
    fullApiPath = `/api/v1/events${pathOnly.startsWith('/') ? '' : '/'}${pathOnly}`;
  }

  const targetUrl = `${config.eventRegisterUrl}${fullApiPath}${queryString ? `?${queryString}` : ''}`;

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
    console.error(`[Gateway Proxy Error -> Event Register] ${targetUrl}:`, err.message);
    return res.status(502).json({ error: 'Event Register service unavailable', details: err.message });
  }
}

async function proxyToFiles(req, res, next) {
  let identity;
  try {
    identity = resolveIdentity(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Invalid or expired token' });
  }
  const [pathOnly, queryString] = req.originalUrl.split('?');
  const targetUrl = `${config.fileServiceUrl}${pathOnly}${queryString ? `?${queryString}` : ''}`;

  const signedHeaders = buildCoreGatewayHeaders(
    req.method,
    pathOnly,
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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
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
