ALTER TYPE hr_application_stage_type ADD VALUE 'accepted';

CREATE TYPE hr_onboarding_item_status_type AS ENUM ('todo', 'done');

CREATE TABLE IF NOT EXISTS hr_onboarding_items (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  assignee_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  status hr_onboarding_item_status_type NOT NULL DEFAULT 'todo',
  completed_at TIMESTAMPTZ,
  completed_by_user_ref_id UUID REFERENCES users_ref(id) ON DELETE SET NULL,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_onboarding_items_assignee_status
  ON hr_onboarding_items (assignee_user_ref_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_onboarding_items_committee_id
  ON hr_onboarding_items (committee_id);
CREATE INDEX IF NOT EXISTS idx_hr_onboarding_items_application_id
  ON hr_onboarding_items (application_id);
