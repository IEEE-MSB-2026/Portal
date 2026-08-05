CREATE TYPE media_album_status_type AS ENUM ('draft', 'published');
CREATE TYPE media_coverage_status_type AS ENUM ('requested', 'accepted', 'rejected', 'completed');
CREATE TYPE media_coverage_activity_action_type AS ENUM ('created', 'status_changed', 'linked_task_created');

CREATE TABLE IF NOT EXISTS media_albums (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status media_album_status_type NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  updated_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_albums_committee_status_created
  ON media_albums (committee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_album_assets (
  id UUID PRIMARY KEY,
  album_id UUID NOT NULL REFERENCES media_albums(id) ON DELETE CASCADE,
  asset_url TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  caption TEXT,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_album_assets_album_id_created
  ON media_album_assets (album_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_coverage_requests (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  media_committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  event_at TIMESTAMPTZ,
  status media_coverage_status_type NOT NULL DEFAULT 'requested',
  requested_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  accepted_by_user_ref_id UUID REFERENCES users_ref(id) ON DELETE SET NULL,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_coverage_requests_committee_status
  ON media_coverage_requests (committee_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_coverage_requests_media_committee_status
  ON media_coverage_requests (media_committee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_coverage_activity_log (
  id UUID PRIMARY KEY,
  coverage_request_id UUID NOT NULL REFERENCES media_coverage_requests(id) ON DELETE CASCADE,
  action media_coverage_activity_action_type NOT NULL,
  actor_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  from_status media_coverage_status_type,
  to_status media_coverage_status_type,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_coverage_activity_log_request_created
  ON media_coverage_activity_log (coverage_request_id, created_at DESC);
