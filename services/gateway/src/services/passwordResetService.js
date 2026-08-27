const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const userRepository = require('../repositories/userRepository');
const passwordResetRepository = require('../repositories/passwordResetRepository');
const refreshTokenRepository = require('../repositories/refreshTokenRepository');
const { hashPassword } = require('../utils/passwordUtils');

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

/**
 * Step 1: Request a 6-digit OTP code for password recovery
 */
async function requestOtp(email) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    const err = new Error('Email is required');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizedEmail);

  // Return generic success message to prevent user enumeration attacks
  if (!user) {
    return {
      message: 'If the email address exists in our system, a 6-digit verification code has been sent.',
      email: normalizedEmail,
    };
  }

  // Generate a cryptographically secure 6-digit numeric OTP (100000 - 999999)
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

  await passwordResetRepository.createOtp({
    userId: user.id,
    otpHash,
    expiresAt,
  });

  // Always log OTP in development or test environments for easy local testing
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n======================================================`);
    console.log(`🔑 [AUTH-DEV] Password Reset OTP for ${user.email}: ${otp}`);
    console.log(`⏱️  Expires at: ${expiresAt.toISOString()} (10 minutes)`);
    console.log(`======================================================\n`);
  }

  // Dispatched via Email Service (asynchronously, graceful fallback)
  try {
    const emailHtml = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 10px; background-color: #00629B; color: #ffffff; font-weight: bold; font-size: 18px;">IEEE</div>
          <h2 style="margin: 12px 0 4px 0; color: #002F4C; font-size: 20px; font-weight: 700;">IEEE Menoufia Student Branch</h2>
          <p style="margin: 0; font-size: 13px; color: #64748b;">Member Portal Security</p>
        </div>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 20px;">
          <p style="font-size: 15px; line-height: 1.5; color: #334155;">Hello <strong>${user.name}</strong>,</p>
          <p style="font-size: 14px; line-height: 1.6; color: #475569;">
            We received a request to reset your password. Use the 6-digit verification code below to complete your password recovery:
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <div style="display: inline-block; letter-spacing: 8px; font-size: 32px; font-weight: 800; color: #00629B; background-color: #f0f9ff; padding: 14px 28px; border-radius: 8px; border: 1px solid #bae6fd; font-family: monospace;">
              ${otp}
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 8px;">Valid for 10 minutes</p>
          </div>
          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            If you did not request this password reset, please ignore this message or contact your branch administrator immediately.
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
        to: [user.email],
        subject: `${otp} is your IEEE Portal password reset code`,
        html: emailHtml,
        text: `Your IEEE Portal password reset code is: ${otp}. It expires in 10 minutes.`,
      }),
    }).catch((err) => {
      console.warn(`[Gateway] Email dispatch to ${user.email} skipped or failed:`, err.message);
    });
  } catch (emailErr) {
    console.warn('[Gateway] Email service request error:', emailErr.message);
  }

  return {
    message: 'If the email address exists in our system, a 6-digit verification code has been sent.',
    email: normalizedEmail,
  };
}

/**
 * Step 2: Verify the 6-digit OTP code and issue a short-lived reset token
 */
async function verifyOtp({ email, otp }) {
  if (!email || !otp) {
    const err = new Error('Email and verification code are required');
    err.status = 400;
    throw err;
  }

  const cleanOtp = String(otp).trim();
  if (!/^\d{6}$/.test(cleanOtp)) {
    const err = new Error('Verification code must be exactly 6 numeric digits');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizedEmail);
  if (!user) {
    const err = new Error('Invalid or expired verification code');
    err.status = 400;
    throw err;
  }

  const otpRecord = await passwordResetRepository.findLatestActiveByUserId(user.id);
  if (!otpRecord) {
    const err = new Error('No active verification code found. Please request a new code.');
    err.status = 400;
    throw err;
  }

  if (new Date() > new Date(otpRecord.expires_at)) {
    await passwordResetRepository.markUsed(otpRecord.id);
    const err = new Error('Verification code has expired. Please request a new code.');
    err.status = 400;
    throw err;
  }

  if (otpRecord.attempts >= 5) {
    await passwordResetRepository.markUsed(otpRecord.id);
    const err = new Error('Maximum verification attempts exceeded. Please request a new code.');
    err.status = 400;
    throw err;
  }

  const enteredHash = hashOtp(cleanOtp);
  if (enteredHash !== otpRecord.otp_hash) {
    const currentAttempts = await passwordResetRepository.incrementAttempts(otpRecord.id);
    const remaining = Math.max(0, 5 - currentAttempts);
    if (remaining === 0) {
      await passwordResetRepository.markUsed(otpRecord.id);
      const err = new Error('Maximum verification attempts exceeded. Please request a new code.');
      err.status = 400;
      throw err;
    }
    const err = new Error(`Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
    err.status = 400;
    throw err;
  }

  // Mark OTP as verified
  await passwordResetRepository.markVerified(otpRecord.id);

  // Issue a short-lived (10 mins) signed reset token
  const resetToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      purpose: 'password_reset',
      otpId: otpRecord.id,
    },
    config.jwtSecret,
    { expiresIn: '10m' }
  );

  return {
    message: 'Verification code confirmed. You may now set your new password.',
    resetToken,
  };
}

/**
 * Step 3: Set new password using verified reset token
 */
async function resetPassword({ resetToken, newPassword }) {
  if (!resetToken || typeof resetToken !== 'string') {
    const err = new Error('Reset token is required');
    err.status = 400;
    throw err;
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    const err = new Error('New password must be at least 8 characters long');
    err.status = 400;
    throw err;
  }

  let decoded;
  try {
    decoded = jwt.verify(resetToken, config.jwtSecret);
  } catch {
    const err = new Error('Reset token has expired or is invalid. Please start over.');
    err.status = 400;
    throw err;
  }

  if (decoded.purpose !== 'password_reset' || !decoded.otpId || !decoded.sub) {
    const err = new Error('Invalid token purpose');
    err.status = 400;
    throw err;
  }

  const otpRecord = await passwordResetRepository.findById(decoded.otpId);
  if (!otpRecord || !otpRecord.is_verified || otpRecord.is_used) {
    const err = new Error('This password reset link has already been used or expired. Please request a new one.');
    err.status = 400;
    throw err;
  }

  // Hash new password with scrypt
  const newPasswordHash = await hashPassword(newPassword);
  await userRepository.updatePassword(decoded.sub, newPasswordHash);

  // Invalidate OTP and revoke all active refresh tokens for maximum security
  await passwordResetRepository.markUsed(otpRecord.id);
  await refreshTokenRepository.revokeAllForUser(decoded.sub);

  return {
    message: 'Password has been reset successfully. You can now log in with your new password.',
  };
}

module.exports = {
  requestOtp,
  verifyOtp,
  resetPassword,
};
