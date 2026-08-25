const jwt = require('jsonwebtoken');
const config = require('../config');
const refreshTokenRepository = require('../repositories/refreshTokenRepository');

function generateAccessToken({ user, role, scopeType, scopeId, committeeName }) {
  const activeRole = role || user.defaultRole || 'member';
  const activeScopeType = scopeType || user.defaultScopeType || 'global';
  const activeScopeId = scopeId || user.defaultScopeId || 'global';

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: activeRole,
      scopeType: activeScopeType,
      scopeId: activeScopeId,
      name: user.name,
      committeeId: activeScopeType === 'committee' ? activeScopeId : null,
      committeeName: committeeName || null,
    },
    config.jwtSecret,
    { expiresIn: config.accessTokenTtl || '15m' }
  );
}

async function issueTokenPair({ user, role, scopeType, scopeId, committeeName }) {
  const token = generateAccessToken({ user, role, scopeType, scopeId, committeeName });
  const { refreshToken, expiresAt } = await refreshTokenRepository.create({
    userId: user.id,
    ttlDays: config.refreshTokenTtlDays,
  });

  return {
    token,
    refreshToken,
    expiresAt,
  };
}

async function rotateRefreshToken(rawRefreshToken) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  const tokenDoc = await refreshTokenRepository.findByRawToken(rawRefreshToken);
  if (!tokenDoc) {
    const err = new Error('Refresh token not found');
    err.status = 401;
    throw err;
  }

  if (new Date() > tokenDoc.expiresAt) {
    const err = new Error('Refresh token expired');
    err.status = 401;
    throw err;
  }

  if (tokenDoc.isRevoked) {
    // Replay attack detected: revoke all tokens in this family immediately
    await refreshTokenRepository.revokeFamily(tokenDoc.familyId);
    const err = new Error('Refresh token reuse detected. Session terminated.');
    err.status = 403;
    throw err;
  }

  // Revoke used token
  await refreshTokenRepository.revokeById(tokenDoc.id);

  // Issue rotated token under same lineage
  const nextToken = await refreshTokenRepository.create({
    userId: tokenDoc.userId,
    familyId: tokenDoc.familyId,
    ttlDays: config.refreshTokenTtlDays,
  });

  return {
    userId: tokenDoc.userId,
    refreshToken: nextToken.refreshToken,
    expiresAt: nextToken.expiresAt,
  };
}

async function revokeRefreshToken(rawRefreshToken) {
  await refreshTokenRepository.revokeByRawToken(rawRefreshToken);
}

module.exports = {
  generateAccessToken,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
};
