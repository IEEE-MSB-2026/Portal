-- Migration 005: Committee High-Value Activities
CREATE TABLE IF NOT EXISTS committee_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_committee_activities_cid ON committee_activities (committee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_committee_activities_target ON committee_activities (target_user_id);
