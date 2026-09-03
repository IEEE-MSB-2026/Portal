-- 013_media_brand_assets_and_updates.sql
-- Brand & Design Kit asset repository and album metadata enhancements

CREATE TABLE IF NOT EXISTS media_brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'logos',
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_format TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_brand_assets_category ON media_brand_assets (category);
CREATE INDEX IF NOT EXISTS idx_media_brand_assets_created ON media_brand_assets (created_at DESC);

-- Album metadata enhancements for rich categorizations and tags
ALTER TABLE media_albums
  ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
