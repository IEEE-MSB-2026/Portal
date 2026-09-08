-- 021_email_verification_and_google_sso.sql
-- Milestone 12: Authentication Hardening — Email Verification & Google SSO (Direct users table columns)

-- 1. Users table additions for email verification and Google SSO
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';

-- Allow NULL password_hash for users authenticated solely via third-party SSO (Google)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Create index for fast verification token lookup
CREATE INDEX IF NOT EXISTS idx_users_verification_token_hash ON users (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

-- Existing seeded accounts (Admins, Officers, Committee Leads) are marked verified by default
UPDATE users SET is_email_verified = TRUE WHERE is_email_verified = FALSE;
