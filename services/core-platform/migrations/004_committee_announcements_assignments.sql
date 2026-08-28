-- Migration: 004_committee_announcements_assignments.sql
-- Description: Create dedicated tables for committee_announcements, committee_assignments, and assignment_submissions.

-- 1. Committee Announcements Table (Separate from global PR announcements)
CREATE TABLE IF NOT EXISTS committee_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_committee_announcements_cid ON committee_announcements (committee_id, created_at DESC);

-- 2. Committee Assignments Table
CREATE TABLE IF NOT EXISTS committee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  max_points INT NOT NULL DEFAULT 100,
  attachment_url TEXT,
  attachment_name TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_committee_assignments_cid ON committee_assignments (committee_id, created_at DESC);

-- 3. Assignment Submissions Table
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES committee_assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  grade INT,
  feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_assignment_user_submission UNIQUE(assignment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_aid ON assignment_submissions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_uid ON assignment_submissions (user_id);
