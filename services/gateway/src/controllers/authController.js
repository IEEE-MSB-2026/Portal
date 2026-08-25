const authService = require('../services/authService');

function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
  });
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const result = await authService.login({ email, password });
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    res.json({
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

async function register(req, res, next) {
  try {
    const { email, password, name, role, scopeType, scopeId, committeeId } = req.body || {};
    const result = await authService.register({ email, password, name, role, scopeType, scopeId, committeeId });
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    res.status(201).json({
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

async function switchContext(req, res, next) {
  try {
    const { targetScopeId, scopeId, id } = req.body || {};
    const selectedScopeId = targetScopeId || scopeId || id;

    if (!selectedScopeId) {
      return res.status(400).json({ error: 'targetScopeId is required for context switch' });
    }

    const result = await authService.switchContext({
      user: req.user,
      targetScopeId: selectedScopeId,
    });

    res.json({
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    const result = await authService.refreshTokens(rawRefreshToken);
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    res.json({
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    await authService.logout(rawRefreshToken);
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const { passwordHash: _, ...userData } = req.user;
    res.json({
      user: {
        ...userData,
        role: req.identity.role,
        scopeType: req.identity.scopeType,
        scopeId: req.identity.scopeId,
        committeeId: req.identity.committeeId,
        committeeName: req.identity.committeeName,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMe,
  login,
  logout,
  refresh,
  register,
  switchContext,
};
