CREATE TYPE role_in_committee_type AS ENUM ('member', 'lead');
CREATE TYPE task_status_type AS ENUM ('todo', 'in_progress', 'done');
CREATE TYPE task_activity_action_type AS ENUM ('created', 'assigned', 'status_changed');

CREATE TABLE IF NOT EXISTS users_ref (
  id UUID PRIMARY KEY,
  external_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS committees (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS committee_memberships (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE CASCADE,
  role_in_committee role_in_committee_type NOT NULL,
  UNIQUE (committee_id, user_ref_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  created_by_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  status task_status_type NOT NULL DEFAULT 'todo',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_committee_id ON tasks (committee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_user_ref_id ON tasks (assignee_user_ref_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC);

CREATE TABLE IF NOT EXISTS task_activity_log (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_ref_id UUID NOT NULL REFERENCES users_ref(id) ON DELETE RESTRICT,
  action task_activity_action_type NOT NULL,
  from_status task_status_type,
  to_status task_status_type,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_log_task_id ON task_activity_log (task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_log_created_at ON task_activity_log (created_at DESC);
