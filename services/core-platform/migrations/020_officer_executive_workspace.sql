-- 020_officer_executive_workspace.sql
-- Milestone 11: Officer Executive Workspace & Governance Vault

-- 1. Support Board Kanban tasks without creating a 9th committee
ALTER TABLE tasks ALTER COLUMN committee_id DROP NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_board_task BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks (is_board_task) WHERE is_board_task = TRUE;

-- 2. Internal Executive Committee (Excom) Team Members & Role Assignments
CREATE TABLE IF NOT EXISTS branch_excom_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position TEXT NOT NULL,
  custom_title TEXT,
  season TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  appointed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, season)
);

CREATE INDEX IF NOT EXISTS idx_branch_excom_season ON branch_excom_members (season);
CREATE INDEX IF NOT EXISTS idx_branch_excom_user ON branch_excom_members (user_id);
CREATE INDEX IF NOT EXISTS idx_branch_excom_active ON branch_excom_members (is_active);

-- 3. Branch Governance Vault & Official Archives
CREATE TABLE IF NOT EXISTS branch_governance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size_bytes BIGINT,
  tag TEXT,
  description TEXT,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gov_docs_created ON branch_governance_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_docs_tag ON branch_governance_documents (tag);
