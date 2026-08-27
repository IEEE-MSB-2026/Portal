const userRepository = require('../repositories/userRepository');
const tokenService = require('./tokenService');
const { verifyPassword } = require('../utils/passwordUtils');

async function login({ email, password }) {
  if (!email) {
    const err = new Error('Email is required');
    err.status = 400;
    throw err;
  }

  const user = await userRepository.findByEmail(email);
  if (!user) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const isValidPassword = await verifyPassword(password || '', user.passwordHash);
  if (!isValidPassword) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const { token, refreshToken, expiresAt } = await tokenService.issueTokenPair({
    user,
    role: user.defaultRole,
    scopeType: user.defaultScopeType,
    scopeId: user.defaultScopeId,
  });

  const { passwordHash: _, ...userData } = user;
  return {
    token,
    refreshToken,
    expiresAt,
    user: {
      ...userData,
      role: user.defaultRole,
      scopeType: user.defaultScopeType,
      scopeId: user.defaultScopeId,
    },
  };
}

async function register({ email, password, name, membershipId = null, role = 'member', scopeType, scopeId, committeeId }) {
  if (!email || !password || !name) {
    const err = new Error('Name, email, and password are required');
    err.status = 400;
    throw err;
  }

  const user = await userRepository.create({
    email,
    password,
    name,
    membershipId,
    role,
    scopeType: scopeType || (committeeId ? 'committee' : 'global'),
    scopeId: scopeId || committeeId || 'global',
    committeeId,
  });

  const { token, refreshToken, expiresAt } = await tokenService.issueTokenPair({
    user,
    role: user.defaultRole,
    scopeType: user.defaultScopeType,
    scopeId: user.defaultScopeId,
  });

  const { passwordHash: _, ...userData } = user;
  return {
    token,
    refreshToken,
    expiresAt,
    user: {
      ...userData,
      role: user.defaultRole,
      scopeType: user.defaultScopeType,
      scopeId: user.defaultScopeId,
    },
  };
}

async function switchContext({ user, targetScopeId }) {
  if (!targetScopeId) {
    const err = new Error('targetScopeId is required for context switch');
    err.status = 400;
    throw err;
  }

  const available = user.availableScopes || [];
  const target = available.find((s) => s.id === targetScopeId || s.scopeId === targetScopeId);

  if (!target) {
    const err = new Error('You do not possess the requested role or scope');
    err.status = 403;
    throw err;
  }

  const newToken = tokenService.generateAccessToken({
    user,
    role: target.role,
    scopeType: target.scopeType,
    scopeId: target.scopeId,
    committeeName: target.committeeName,
  });

  const { passwordHash: _, ...userData } = user;
  return {
    token: newToken,
    user: {
      ...userData,
      role: target.role,
      scopeType: target.scopeType,
      scopeId: target.scopeId,
      committeeId: target.committeeId || (target.scopeType === 'committee' ? target.scopeId : null),
      committeeName: target.committeeName || null,
      activeScope: target,
      availableScopes: available,
    },
  };
}

async function refreshTokens(rawRefreshToken) {
  if (!rawRefreshToken) {
    const err = new Error('Refresh token required in cookie or body');
    err.status = 401;
    throw err;
  }

  const { userId, refreshToken: newRefreshToken, expiresAt } = await tokenService.rotateRefreshToken(rawRefreshToken);
  const user = await userRepository.findById(userId);
  if (!user) {
    const err = new Error('User session invalid');
    err.status = 401;
    throw err;
  }

  const token = tokenService.generateAccessToken({
    user,
    role: user.defaultRole,
    scopeType: user.defaultScopeType,
    scopeId: user.defaultScopeId,
  });

  const { passwordHash: _, ...userData } = user;
  return {
    token,
    refreshToken: newRefreshToken,
    expiresAt,
    user: {
      ...userData,
      role: user.defaultRole,
      scopeType: user.defaultScopeType,
      scopeId: user.defaultScopeId,
    },
  };
}

async function logout(rawRefreshToken) {
  if (rawRefreshToken) {
    await tokenService.revokeRefreshToken(rawRefreshToken);
  }
}

module.exports = {
  login,
  logout,
  refreshTokens,
  register,
  switchContext,
};
