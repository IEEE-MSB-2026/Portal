-- Migration 017: Add revoked_at to auth_refresh_tokens for rotation grace window support
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_family_revoked ON auth_refresh_tokens (family_id, is_revoked);
