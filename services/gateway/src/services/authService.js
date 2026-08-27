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

  const defaultScope = (user.availableScopes || []).find(
    (s) => (s.scopeId === user.defaultScopeId || s.committeeId === user.defaultScopeId) && s.role === user.defaultRole
  );
  const committeeSlug = defaultScope?.committeeSlug || null;
  const committeeId = defaultScope?.committeeId || (user.defaultScopeType === 'committee' ? user.defaultScopeId : null);

  const { token, refreshToken, expiresAt } = await tokenService.issueTokenPair({
    user,
    role: user.defaultRole,
    scopeType: user.defaultScopeType,
    scopeId: user.defaultScopeId,
    committeeSlug,
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
      committeeId,
      committeeSlug,
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

  const defaultScope = (user.availableScopes || []).find(
    (s) => (s.scopeId === user.defaultScopeId || s.committeeId === user.defaultScopeId) && s.role === user.defaultRole
  );
  const committeeSlug = defaultScope?.committeeSlug || null;

  const { token, refreshToken, expiresAt } = await tokenService.issueTokenPair({
    user,
    role: user.defaultRole,
    scopeType: user.defaultScopeType,
    scopeId: user.defaultScopeId,
    committeeSlug,
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
      committeeId: user.defaultScopeType === 'committee' ? user.defaultScopeId : null,
      committeeSlug,
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
    committeeSlug: target.committeeSlug,
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
      committeeSlug: target.committeeSlug || null,
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

  const defaultScope = (user.availableScopes || []).find(
    (s) => (s.scopeId === user.defaultScopeId || s.committeeId === user.defaultScopeId) && s.role === user.defaultRole
  );
  const committeeSlug = defaultScope?.committeeSlug || null;
  const committeeId = defaultScope?.committeeId || (user.defaultScopeType === 'committee' ? user.defaultScopeId : null);

  const token = tokenService.generateAccessToken({
    user,
    role: user.defaultRole,
    scopeType: user.defaultScopeType,
    scopeId: user.defaultScopeId,
    committeeSlug,
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
      committeeId,
      committeeSlug,
    },
  };
}

async function logout(rawRefreshToken) {
  if (rawRefreshToken) {
    await tokenService.revokeRefreshToken(rawRefreshToken);
  }
}

const { hashPassword } = require('../utils/passwordUtils');

async function changePassword({ userId, currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    const err = new Error('Current password and new password are required');
    err.status = 400;
    throw err;
  }

  if (newPassword.length < 8) {
    const err = new Error('New password must be at least 8 characters');
    err.status = 400;
    throw err;
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    const err = new Error('Current password is incorrect');
    err.status = 401;
    throw err;
  }

  const newHash = await hashPassword(newPassword);
  await userRepository.updatePassword(userId, newHash);

  return { message: 'Password changed successfully' };
}

module.exports = {
  changePassword,
  login,
  logout,
  refreshTokens,
  register,
  switchContext,
};
