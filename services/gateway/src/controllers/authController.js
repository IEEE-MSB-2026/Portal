const authService = require('../services/authService');

function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
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
    const { email, password, name, membershipId, membership_id, role, scopeType, scopeId, committeeId } = req.body || {};
    const memId = membershipId || membership_id || null;
    const result = await authService.register({ email, password, name, membershipId: memId, role, scopeType, scopeId, committeeId });
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
    const activeScopeId = req.body?.activeScopeId || req.query?.activeScopeId || null;
    const result = await authService.refreshTokens(rawRefreshToken, activeScopeId);
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
    res.clearCookie('refreshToken', { path: '/api/auth' });
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
        committeeSlug: req.identity.committeeSlug,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (confirmPassword !== undefined && confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'New password and confirmation do not match' });
    }

    const result = await authService.changePassword({
      userId: req.user.id,
      currentPassword,
      newPassword,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

const passwordResetService = require('../services/passwordResetService');

async function requestPasswordResetOtp(req, res, next) {
  try {
    const { email } = req.body || {};
    const result = await passwordResetService.requestOtp(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function verifyPasswordResetOtp(req, res, next) {
  try {
    const { email, otp } = req.body || {};
    const result = await passwordResetService.verifyOtp({ email, otp });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function resetPasswordWithToken(req, res, next) {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body || {};
    if (confirmPassword !== undefined && confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    const result = await passwordResetService.resetPassword({ resetToken, newPassword });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  changePassword,
  getMe,
  login,
  logout,
  refresh,
  register,
  requestPasswordResetOtp,
  resetPasswordWithToken,
  switchContext,
  verifyPasswordResetOtp,
};
