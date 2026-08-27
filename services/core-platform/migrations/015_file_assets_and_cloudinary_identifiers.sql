-- Migration: 015_file_assets_and_cloudinary_identifiers.sql
-- Description: Centralized file_assets registry for Cloudinary direct uploads and entity identifier links

CREATE TABLE IF NOT EXISTS file_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_ref_id UUID REFERENCES users_ref(id) ON DELETE SET NULL,
  purpose VARCHAR(50) NOT NULL DEFAULT 'general',
  cloudinary_asset_id TEXT NOT NULL,
  cloudinary_public_id TEXT NOT NULL,
  resource_type VARCHAR(20) NOT NULL DEFAULT 'image',
  format VARCHAR(20),
  secure_url TEXT NOT NULL,
  bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_assets_owner ON file_assets (owner_user_ref_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_public_id ON file_assets (cloudinary_public_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_asset_id ON file_assets (cloudinary_asset_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_purpose ON file_assets (purpose);

-- Add Cloudinary identifiers to users_ref
ALTER TABLE users_ref ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT;
ALTER TABLE users_ref ADD COLUMN IF NOT EXISTS cloudinary_asset_id TEXT;

-- Add Cloudinary identifiers to auth_users
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS cloudinary_asset_id TEXT;
