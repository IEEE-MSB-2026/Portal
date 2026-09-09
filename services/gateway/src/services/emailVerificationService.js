const crypto = require('crypto');
const config = require('../config');
const userRepository = require('../repositories/userRepository');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function sendVerificationEmail(user, rawToken, portalBaseUrl) {
  const baseUrl = portalBaseUrl || config.frontendUrl;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const verificationUrl = `${normalizedBase}/verify-email?token=${encodeURIComponent(rawToken)}`;

  // Log in dev / test for instantaneous testing
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n======================================================`);
    console.log(`[DEV / TEST EMAIL VERIFICATION LINK]`);
    console.log(`Target User: ${user.email} (${user.name})`);
    console.log(`Verification URL: ${verificationUrl}`);
    console.log(`Valid for: 24 Hours`);
    console.log(`======================================================\n`);
  }

  // Dispatch via Email Service
  try {
    const emailHtml = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 10px; background-color: #00629B; color: #ffffff; font-weight: bold; font-size: 18px;">IEEE</div>
          <h2 style="margin: 12px 0 4px 0; color: #002F4C; font-size: 20px; font-weight: 700;">IEEE Menoufia Student Branch</h2>
          <p style="margin: 0; font-size: 13px; color: #64748b;">Member Onboarding & Security</p>
        </div>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 20px;">
          <p style="font-size: 15px; line-height: 1.5; color: #334155;">Hello <strong>${user.name}</strong>,</p>
          <p style="font-size: 14px; line-height: 1.6; color: #475569;">
            Welcome to the IEEE Menoufia Student Branch Portal! Please confirm your email address to complete your registration and activate your verified member privileges:
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${verificationUrl}" target="_blank" style="display: inline-block; background-color: #00629B; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 28px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 98, 155, 0.25);">
              Verify Email Address
            </a>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 12px;">This link is valid for 24 hours.</p>
          </div>
          <p style="font-size: 12px; color: #64748b; line-height: 1.5; word-break: break-all;">
            If the button doesn't work, copy and paste this link into your browser:<br />
            <a href="${verificationUrl}" style="color: #00629B;">${verificationUrl}</a>
          </p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
            If you did not create an IEEE Portal account, please disregard this email.
          </p>
        </div>
      </div>
    `;

    fetch(`${config.emailServiceUrl}/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-token': config.iamServiceAuthToken,
      },
      body: JSON.stringify({
        idempotencyKey: `verify-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        to: [user.email],
        subject: `Verify your email for IEEE Menoufia Student Branch`,
        html: emailHtml,
        text: `Hello ${user.name},\n\nPlease verify your email address for IEEE Menoufia Student Branch by opening the following link:\n${verificationUrl}\n\nThis link expires in 24 hours.`,
      }),
    }).catch((err) => {
      console.warn(`[Gateway] Email verification dispatch to ${user.email} skipped or failed:`, err.message);
    });
  } catch (emailErr) {
    console.warn('[Gateway] Email service request error:', emailErr.message);
  }
}

async function generateAndSendVerification(user, portalBaseUrl) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await userRepository.setVerificationToken(user.id, tokenHash, expiresAt);
  await sendVerificationEmail(user, rawToken, portalBaseUrl);

  return { rawToken, expiresAt };
}

async function verifyEmail(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    const err = new Error('Verification token is required');
    err.status = 400;
    throw err;
  }

  const tokenHash = hashToken(rawToken.trim());
  const updatedUser = await userRepository.verifyEmailByToken(tokenHash);

  if (!updatedUser) {
    // Check if token existed but expired or already verified
    const existing = await userRepository.findUserByVerificationToken(tokenHash);
    if (existing) {
      if (existing.is_email_verified) {
        return {
          success: true,
          alreadyVerified: true,
          message: 'Email address has already been verified.',
          user: await userRepository.findById(existing.id),
        };
      }
      const err = new Error('Verification link has expired. Please request a new one.');
      err.status = 400;
      throw err;
    }

    const err = new Error('Invalid or expired verification token.');
    err.status = 400;
    throw err;
  }

  return {
    success: true,
    alreadyVerified: false,
    message: 'Email address verified successfully.',
    user: updatedUser,
  };
}

async function resendVerification(target) {
  const userId = typeof target === 'string' ? target : target?.userId;
  const email = typeof target === 'object' ? target?.email : null;
  const portalBaseUrl = typeof target === 'object' ? target?.portalBaseUrl : null;

  let user = null;
  if (userId) {
    user = await userRepository.findById(userId);
  } else if (email && typeof email === 'string') {
    const cleanEmail = email.trim().toLowerCase();
    user = await userRepository.findByEmail(cleanEmail);
    // Generic response to prevent email enumeration
    if (!user) {
      return {
        success: true,
        alreadyVerified: false,
        message: 'If an unverified account exists with that email address, a verification link has been sent.',
      };
    }
  }

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (user.isEmailVerified) {
    return {
      success: true,
      alreadyVerified: true,
      message: 'Your email address is already verified.',
    };
  }

  // Cooldown check (60 seconds)
  if (user.emailVerificationSentAt) {
    const sentTime = new Date(user.emailVerificationSentAt).getTime();
    const elapsedSeconds = Math.floor((Date.now() - sentTime) / 1000);
    const COOLDOWN_SECONDS = 60;
    if (elapsedSeconds < COOLDOWN_SECONDS) {
      const remaining = COOLDOWN_SECONDS - elapsedSeconds;
      const err = new Error(`Please wait ${remaining} seconds before requesting another verification email.`);
      err.status = 429;
      err.retryAfterSeconds = remaining;
      throw err;
    }
  }

  await generateAndSendVerification(user, portalBaseUrl);

  return {
    success: true,
    alreadyVerified: false,
    message: 'A new verification link has been sent to your email address.',
  };
}

module.exports = {
  generateAndSendVerification,
  verifyEmail,
  resendVerification,
};
