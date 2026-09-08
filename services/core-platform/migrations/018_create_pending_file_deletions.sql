-- 018_create_pending_file_deletions.sql
-- Outbox queue for asynchronous Cloudinary asset deletions triggered by domain events

CREATE TABLE IF NOT EXISTS pending_file_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_asset_id UUID REFERENCES file_assets(id) ON DELETE SET NULL,
  cloudinary_public_id TEXT,
  secure_url TEXT,
  resource_type TEXT NOT NULL DEFAULT 'image',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_file_deletions_status 
  ON pending_file_deletions (status, created_at);
