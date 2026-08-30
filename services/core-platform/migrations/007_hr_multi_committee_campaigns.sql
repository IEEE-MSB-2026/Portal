-- 007_hr_multi_committee_campaigns.sql
-- Support multi-committee recruitment campaigns via junction table and targeted application committee

-- 1. Make committee_id on hr_campaigns nullable
ALTER TABLE hr_campaigns ALTER COLUMN committee_id DROP NOT NULL;

-- 2. Create hr_campaign_committees junction table
CREATE TABLE IF NOT EXISTS hr_campaign_committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES hr_campaigns(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, committee_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_campaign_committees_campaign ON hr_campaign_committees (campaign_id);
CREATE INDEX IF NOT EXISTS idx_hr_campaign_committees_committee ON hr_campaign_committees (committee_id);

-- 3. Backfill existing campaigns into junction table
INSERT INTO hr_campaign_committees (campaign_id, committee_id)
SELECT id, committee_id FROM hr_campaigns
WHERE committee_id IS NOT NULL
ON CONFLICT (campaign_id, committee_id) DO NOTHING;

-- 4. Add committee_id to hr_applications to record applicant target committee
ALTER TABLE hr_applications ADD COLUMN IF NOT EXISTS committee_id UUID REFERENCES committees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hr_applications_committee ON hr_applications (committee_id);
