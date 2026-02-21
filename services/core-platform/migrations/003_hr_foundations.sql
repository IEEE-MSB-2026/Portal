CREATE TYPE hr_campaign_status_type AS ENUM ('draft', 'open', 'closed');
CREATE TYPE hr_application_stage_type AS ENUM ('applied', 'screening', 'interview', 'final_review', 'rejected');

CREATE TABLE IF NOT EXISTS hr_campaigns (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  status hr_campaign_status_type NOT NULL DEFAULT 'draft',
  form_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hr_campaigns_window_chk CHECK (closes_at > opens_at)
);

CREATE INDEX IF NOT EXISTS idx_hr_campaigns_committee_id ON hr_campaigns (committee_id);
CREATE INDEX IF NOT EXISTS idx_hr_campaigns_status_opens_closes ON hr_campaigns (status, opens_at, closes_at);

CREATE TABLE IF NOT EXISTS hr_applications (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES hr_campaigns(id) ON DELETE CASCADE,
  applicant_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_stage hr_application_stage_type NOT NULL DEFAULT 'applied',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, applicant_user_ref_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_applications_campaign_id ON hr_applications (campaign_id);
CREATE INDEX IF NOT EXISTS idx_hr_applications_campaign_stage ON hr_applications (campaign_id, current_stage);

CREATE TABLE IF NOT EXISTS hr_application_stage_log (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  from_stage hr_application_stage_type,
  to_stage hr_application_stage_type NOT NULL,
  score INTEGER,
  notes TEXT,
  actor_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_application_stage_log_application_id ON hr_application_stage_log (application_id);
CREATE INDEX IF NOT EXISTS idx_hr_application_stage_log_created_at ON hr_application_stage_log (created_at DESC);
