CREATE TYPE pr_campaign_status_type AS ENUM ('draft', 'scheduled', 'sent', 'failed');
CREATE TYPE pr_campaign_segment_type AS ENUM ('all_members', 'committee_members', 'committee_leads');

CREATE TABLE IF NOT EXISTS pr_campaigns (
  id UUID PRIMARY KEY,
  committee_id UUID REFERENCES committees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  segment_type pr_campaign_segment_type NOT NULL,
  status pr_campaign_status_type NOT NULL DEFAULT 'draft',
  scheduled_for TIMESTAMPTZ,
  dispatch_request_id UUID,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  updated_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  CONSTRAINT pr_campaigns_segment_scope_chk CHECK (
    (segment_type = 'all_members' AND committee_id IS NULL)
    OR (segment_type IN ('committee_members', 'committee_leads') AND committee_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pr_campaigns_committee_status
  ON pr_campaigns (committee_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_campaigns_status_created_at
  ON pr_campaigns (status, created_at DESC);

CREATE TABLE IF NOT EXISTS pr_campaign_dispatch_log (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES pr_campaigns(id) ON DELETE CASCADE,
  dispatch_request_id UUID NOT NULL,
  actor_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  status pr_campaign_status_type NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_campaign_dispatch_log_campaign_id
  ON pr_campaign_dispatch_log (campaign_id, created_at DESC);
