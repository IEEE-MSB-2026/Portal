const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { DEMO_USERS, findUserByEmail, findUserById, registerUser } = require('./authStore');
const { buildCoreGatewayHeaders, buildEventClaimsHeaders } = require('./signer');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Auth & Persona Endpoints
app.get('/api/auth/personas', (req, res) => {
  res.json({
    personas: DEMO_USERS.map(({ password, ...rest }) => rest),
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = findUserByEmail(email);
  if (!user || (password && user.password !== password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      scopeType: user.scopeType,
      scopeId: user.scopeId,
      name: user.name,
      committeeId: user.committeeId || null,
      committeeName: user.committeeName || null,
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  const { password: _, ...userData } = user;
  res.json({
    token,
    user: userData,
  });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name, role, committeeId } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    const user = registerUser({ email, password, name, role, committeeId });
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        scopeType: user.scopeType,
        scopeId: user.scopeId,
        name: user.name,
        committeeId: user.committeeId || null,
        committeeName: user.committeeName || null,
      },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
    const { password: _, ...userData } = user;
    res.status(201).json({ token, user: userData });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==============================================================================
// JWT Authentication Middlewares (DRY)
// ==============================================================================

function requireJwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header with Bearer token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = findUserById(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: 'User not found or session expired' });
    }

    req.user = user;
    req.decoded = decoded;
    req.identity = {
      userId: decoded.sub,
      email: decoded.email,
      role: decoded.role || user.role,
      scopeType: decoded.scopeType || user.scopeType,
      scopeId: decoded.scopeId || user.scopeId,
      committeeId: decoded.committeeId !== undefined ? decoded.committeeId : user.committeeId,
      committeeName: decoded.committeeName !== undefined ? decoded.committeeName : user.committeeName,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalJwtAuth(req, res, next) {
  req.identity = {
    userId: 'guest-1',
    email: 'guest@ieee.local',
    role: 'visitor',
    scopeType: 'global',
    scopeId: 'global',
  };

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      req.decoded = decoded;
      req.identity = {
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'member',
        scopeType: decoded.scopeType || 'global',
        scopeId: decoded.scopeId || 'global',
      };
    } catch {
      // Invalid token falls back to visitor identity
    }
  }

  next();
}

app.post('/api/auth/switch-context', requireJwtAuth, (req, res) => {
  const { role, scopeType, scopeId, committeeId, committeeName } = req.body || {};
  if (!role) {
    return res.status(400).json({ error: 'role is required for context switch' });
  }

  const user = req.user;
  const activeUser = {
    ...user,
    role: role || user.role,
    scopeType: scopeType || (committeeId ? 'committee' : 'global'),
    scopeId: scopeId || committeeId || 'global',
    committeeId: committeeId !== undefined ? committeeId : user.committeeId,
    committeeName: committeeName !== undefined ? committeeName : user.committeeName,
  };

  const newToken = jwt.sign(
    {
      sub: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      scopeType: activeUser.scopeType,
      scopeId: activeUser.scopeId,
      name: activeUser.name,
      committeeId: activeUser.committeeId,
      committeeName: activeUser.committeeName,
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  const { password: _, ...userData } = activeUser;
  return res.json({
    token: newToken,
    user: userData,
  });
});

app.get('/api/auth/me', requireJwtAuth, (req, res) => {
  const { password: _, ...userData } = req.user;
  return res.json({
    user: {
      ...userData,
      role: req.identity.role,
      scopeType: req.identity.scopeType,
      scopeId: req.identity.scopeId,
      committeeId: req.identity.committeeId,
      committeeName: req.identity.committeeName,
    },
  });
});

// Security middleware to verify x-service-token for internal microservice requests
function verifyInternalServiceAuth(req, res, next) {
  const serviceToken = req.headers['x-service-token'];
  if (!serviceToken || serviceToken !== config.iamServiceAuthToken) {
    return res.status(401).json({ error: 'Unauthorized internal service request: invalid or missing x-service-token' });
  }
  next();
}

// Internal IAM Role Assignment endpoint for microservices
app.post('/admin/roles/assign', verifyInternalServiceAuth, (req, res) => {
  const { userId, role, scopeType, scopeId } = req.body || {};
  if (!userId || !role) {
    return res.status(400).json({ error: 'userId and role are required' });
  }

  const user = findUserById(userId);
  if (user) {
    user.role = role;
    user.scopeType = scopeType || user.scopeType;
    user.scopeId = scopeId || user.scopeId;
    if (scopeType === 'committee') {
      user.committeeId = scopeId;
    }
  }

  return res.status(200).json({ status: 'ok', userId, role, scopeType, scopeId });
});

// Helper to resolve user identity from Auth token or Headers
function resolveIdentity(req) {
  if (req.identity) {
    return req.identity;
  }

  let identity = {
    userId: 'guest-1',
    email: 'guest@ieee.local',
    role: 'visitor',
    scopeType: 'global',
    scopeId: 'global',
  };

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      identity = {
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'member',
        scopeType: decoded.scopeType || 'global',
        scopeId: decoded.scopeId || 'global',
      };
    } catch {
      // Invalid token falls back to visitor
    }
  }

  return identity;
}

// 2. Gateway Reverse Proxy to Core Platform Service
app.use('/api/core', async (req, res) => {
  const identity = resolveIdentity(req);
  const rawTargetPath = req.originalUrl.replace('/api/core', '') || '/';
  
  // Normalize target path for core-platform
  let normalizedPath = rawTargetPath;
  if (!normalizedPath.startsWith('/public') && !normalizedPath.startsWith('/core')) {
    normalizedPath = `/core${rawTargetPath}`;
  }

  const gatewayHeaders = buildCoreGatewayHeaders({
    method: req.method,
    path: normalizedPath,
    userId: identity.userId,
    email: identity.email,
    role: identity.role,
    scopeType: identity.scopeType,
    scopeId: identity.scopeId,
  });

  try {
    const targetUrl = `${config.corePlatformUrl}${normalizedPath}`;
    const options = {
      method: req.method,
      headers: {
        ...gatewayHeaders,
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
      },
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Core platform service unavailable', details: err.message });
  }
});

// 3. Gateway Reverse Proxy to Event Register Service
app.use('/api/events', async (req, res) => {
  const identity = resolveIdentity(req);
  const targetPath = req.originalUrl.replace('/api/events', '') || '';

  const eventRole = identity.role === 'event_scanner'
    ? 'scanner'
    : (identity.role === 'admin' ? 'admin' : (identity.role === 'visitor' ? 'visitor' : 'organizer'));

  const eventHeaders = buildEventClaimsHeaders({
    role: eventRole,
    scopeType: identity.scopeType === 'committee' ? 'event' : identity.scopeType,
    scopeId: identity.scopeId,
  });

  try {
    const targetUrl = `${config.eventRegisterUrl}/api/v1/events${targetPath}`;
    const options = {
      method: req.method,
      headers: {
        ...eventHeaders,
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
      },
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Event service unavailable', details: err.message });
  }
});

// 4. Gateway Reverse Proxy to Cloudinary File Service
app.use('/api/files', async (req, res) => {
  const identity = resolveIdentity(req);
  const targetPath = req.originalUrl.replace('/api/files', '') || '/';

  const gatewayHeaders = buildCoreGatewayHeaders({
    method: req.method,
    path: `/api/files${targetPath}`,
    userId: identity.userId,
    email: identity.email,
    role: identity.role,
    scopeType: identity.scopeType,
    scopeId: identity.scopeId,
  });

  try {
    const targetUrl = `${config.fileServiceUrl}/api/files${targetPath}`;
    const options = {
      method: req.method,
      headers: {
        ...gatewayHeaders,
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
      },
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        options.body = req;
        options.duplex = 'half';
      } else if (req.body && Object.keys(req.body).length > 0) {
        options.body = JSON.stringify(req.body);
      }
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'File service unavailable', details: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'portal-gateway' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[Gateway] Portal Gateway running on http://localhost:${config.port}`);
  });
}

module.exports = app;
