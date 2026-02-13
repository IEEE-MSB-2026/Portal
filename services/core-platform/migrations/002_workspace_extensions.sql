CREATE TABLE IF NOT EXISTS committee_resources (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_committee_resources_committee_id ON committee_resources (committee_id);
CREATE INDEX IF NOT EXISTS idx_committee_resources_created_at ON committee_resources (created_at DESC);

CREATE TABLE IF NOT EXISTS committee_announcements (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_committee_announcements_committee_id ON committee_announcements (committee_id);
CREATE INDEX IF NOT EXISTS idx_committee_announcements_created_at ON committee_announcements (created_at DESC);
