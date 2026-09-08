const config = require('../config');
const userRepository = require('../repositories/userRepository');
const tokenService = require('./tokenService');
const { resolveEffectiveScope } = require('./authService');

async function verifyGoogleIdToken(credential) {
  if (!credential || typeof credential !== 'string') {
    const err = new Error('Google credential token is required');
    err.status = 400;
    throw err;
  }

  // Test environment mock support
  if (process.env.NODE_ENV === 'test' && credential.startsWith('test-mock-google:')) {
    const parts = credential.split(':');
    return {
      sub: parts[1] || 'mock-google-sub-12345',
      email: parts[2] || 'google.test@ieee.local',
      name: parts[3] || 'Google Test User',
      picture: parts[4] || null,
      email_verified: 'true',
    };
  }

  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential.trim())}`);
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      const err = new Error(errorBody.error_description || 'Invalid or expired Google token');
      err.status = 401;
      throw err;
    }

    const payload = await res.json();

    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      const err = new Error('Google account email is not verified');
      err.status = 400;
      throw err;
    }

    if (config.googleClientId && payload.aud !== config.googleClientId) {
      const err = new Error('Google token was not issued for this application');
      err.status = 401;
      throw err;
    }

    return payload;
  } catch (fetchErr) {
    if (fetchErr.status) throw fetchErr;
    const err = new Error(`Failed to verify Google token: ${fetchErr.message}`);
    err.status = 401;
    throw err;
  }
}

async function loginWithGoogle({ credential }) {
  const payload = await verifyGoogleIdToken(credential);
  const { sub: googleId, email, name, picture } = payload;
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Check if user exists by Google ID
  let user = await userRepository.findByGoogleId(googleId);

  if (!user) {
    // 2. Check if user exists by email
    const existingByEmail = await userRepository.findByEmail(normalizedEmail);
    if (existingByEmail) {
      // If user registered with password (authProvider !== 'google' or googleId is null)
      if (!existingByEmail.googleId) {
        const err = new Error(
          'An account already exists with this email using password authentication. Please sign in with your email and password.'
        );
        err.status = 409;
        throw err;
      }
      user = existingByEmail;
    } else {
      // 3. Provision new user authenticated via Google SSO
      user = await userRepository.createGoogleUser({
        email: normalizedEmail,
        name: name || normalizedEmail.split('@')[0],
        avatarUrl: picture || null,
        googleId,
      });
    }
  }

  // 4. Issue session token pair
  const activeScope = resolveEffectiveScope(user);
  const activeRole = activeScope ? activeScope.role : (user.defaultRole || 'member');
  const activeScopeType = activeScope ? activeScope.scopeType : (user.defaultScopeType || 'global');
  const activeScopeId = activeScope ? activeScope.scopeId : (user.defaultScopeId || 'global');
  const committeeSlug = activeScope?.committeeSlug || null;
  const committeeId = activeScope?.committeeId || (activeScopeType === 'committee' ? activeScopeId : null);

  const { token, refreshToken, expiresAt } = await tokenService.issueTokenPair({
    user,
    role: activeRole,
    scopeType: activeScopeType,
    scopeId: activeScopeId,
    committeeSlug,
  });

  const { passwordHash: _, ...userData } = user;
  return {
    token,
    refreshToken,
    expiresAt,
    user: {
      ...userData,
      role: activeRole,
      scopeType: activeScopeType,
      scopeId: activeScopeId,
      committeeId,
      committeeSlug,
      activeScope: activeScope || null,
      availableScopes: user.availableScopes || [],
    },
  };
}

module.exports = {
  verifyGoogleIdToken,
  loginWithGoogle,
};
