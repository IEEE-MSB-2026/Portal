-- 019_merge_pending_file_deletions_into_file_assets.sql
-- Unified file asset lifecycle: merge pending_file_deletions into file_assets

ALTER TABLE file_assets
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Allow nullable cloudinary_asset_id so untracked legacy URLs queued for deletion can be tracked
ALTER TABLE file_assets
  ALTER COLUMN cloudinary_asset_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_file_assets_status
  ON file_assets (status, created_at);

-- Migrate any existing pending deletions from pending_file_deletions table
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'pending_file_deletions') THEN
    -- Mark existing file_assets as pending_deletion if they were queued
    UPDATE file_assets fa
    SET status = 'pending_deletion',
        retry_count = pfd.retry_count,
        error_message = pfd.error_message,
        updated_at = NOW()
    FROM pending_file_deletions pfd
    WHERE (pfd.file_asset_id IS NOT NULL AND fa.id = pfd.file_asset_id)
       OR (pfd.cloudinary_public_id IS NOT NULL AND fa.cloudinary_public_id = pfd.cloudinary_public_id)
       OR (pfd.secure_url IS NOT NULL AND fa.secure_url = pfd.secure_url);

    -- Insert any queued deletions that did not yet exist in file_assets
    INSERT INTO file_assets (
      id,
      cloudinary_public_id,
      secure_url,
      resource_type,
      status,
      retry_count,
      error_message,
      created_at
    )
    SELECT
      pfd.id,
      COALESCE(pfd.cloudinary_public_id, 'legacy_' || pfd.id),
      COALESCE(pfd.secure_url, 'https://res.cloudinary.com/legacy/' || pfd.id),
      pfd.resource_type,
      'pending_deletion',
      pfd.retry_count,
      pfd.error_message,
      pfd.created_at
    FROM pending_file_deletions pfd
    WHERE pfd.status IN ('pending', 'processing')
      AND NOT EXISTS (
        SELECT 1 FROM file_assets fa
        WHERE fa.id = pfd.file_asset_id
           OR (pfd.cloudinary_public_id IS NOT NULL AND fa.cloudinary_public_id = pfd.cloudinary_public_id)
           OR (pfd.secure_url IS NOT NULL AND fa.secure_url = pfd.secure_url)
      )
    ON CONFLICT DO NOTHING;

    DROP TABLE pending_file_deletions;
  END IF;
END $$;
