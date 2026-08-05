CREATE TYPE pr_announcement_visibility_type AS ENUM ('internal', 'public');
CREATE TYPE pr_announcement_activity_action_type AS ENUM ('created', 'updated', 'deleted');

CREATE TABLE IF NOT EXISTS pr_announcements (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility pr_announcement_visibility_type NOT NULL DEFAULT 'internal',
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  updated_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  deleted_by_user_ref_id UUID REFERENCES users_ref(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pr_announcements_committee_id
  ON pr_announcements (committee_id);
CREATE INDEX IF NOT EXISTS idx_pr_announcements_visibility_deleted_created
  ON pr_announcements (visibility, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_announcements_created_at
  ON pr_announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS pr_announcement_activity_log (
  id UUID PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES pr_announcements(id) ON DELETE CASCADE,
  action pr_announcement_activity_action_type NOT NULL,
  actor_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_announcement_activity_log_announcement_id
  ON pr_announcement_activity_log (announcement_id);
CREATE INDEX IF NOT EXISTS idx_pr_announcement_activity_log_created_at
  ON pr_announcement_activity_log (created_at DESC);
