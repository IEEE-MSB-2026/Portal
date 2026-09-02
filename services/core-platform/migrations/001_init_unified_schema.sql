-- Migration: 001_init_unified_schema.sql
-- Description: Unified canonical production schema with users table, committees, tasks, HR, PR, Media, and IAM.

-- 1. Custom Types
DO $$ BEGIN
  CREATE TYPE role_in_committee_type AS ENUM ('member', 'lead', 'hr');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE task_status_type AS ENUM ('todo', 'in_progress', 'done');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE task_activity_action_type AS ENUM ('created', 'assigned', 'status_changed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE hr_campaign_status_type AS ENUM ('draft', 'open', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE hr_application_stage_type AS ENUM ('applied', 'screening', 'interview', 'final_review', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE hr_onboarding_item_status_type AS ENUM ('todo', 'in_progress', 'done');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pr_announcement_category_type AS ENUM ('General', 'Technical', 'Event', 'Recruitment', 'Opportunity');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pr_announcement_visibility_type AS ENUM ('public', 'internal');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pr_campaign_status_type AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE media_coverage_status_type AS ENUM ('requested', 'accepted', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE media_album_status_type AS ENUM ('draft', 'published');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Core Users Table (Single Source of Truth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  membership_id TEXT,
  avatar_url TEXT,
  cloudinary_public_id TEXT,
  cloudinary_asset_id TEXT,
  default_role TEXT NOT NULL DEFAULT 'member',
  default_scope_type TEXT NOT NULL DEFAULT 'global',
  default_scope_id TEXT NOT NULL DEFAULT 'global',
  bio TEXT,
  university TEXT,
  faculty TEXT,
  department TEXT,
  academic_year TEXT,
  phone TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_membership_id ON users (membership_id) WHERE membership_id IS NOT NULL;

-- 3. Committees
CREATE TABLE IF NOT EXISTS committees (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Committee Memberships
CREATE TABLE IF NOT EXISTS committee_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_committee role_in_committee_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (committee_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_committee_memberships_committee ON committee_memberships (committee_id);
CREATE INDEX IF NOT EXISTS idx_committee_memberships_user ON committee_memberships (user_id);

-- 5. Tasks & Activities
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status task_status_type NOT NULL DEFAULT 'todo',
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_committee ON tasks (committee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_user_id);

CREATE TABLE IF NOT EXISTS task_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action task_activity_action_type NOT NULL,
  from_status task_status_type,
  to_status task_status_type,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_activities_task ON task_activities (task_id);

CREATE OR REPLACE VIEW task_activity_log AS
  SELECT id, task_id, actor_user_id AS actor_user_ref_id, action, from_status, to_status, details, created_at
  FROM task_activities;

-- 6. Committee Resources
CREATE TABLE IF NOT EXISTS committee_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'link',
  description TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_committee_resources_committee ON committee_resources (committee_id);

-- 7. HR Recruitment & Onboarding
CREATE TABLE IF NOT EXISTS hr_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  status hr_campaign_status_type NOT NULL DEFAULT 'draft',
  form_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_campaigns_committee ON hr_campaigns (committee_id);

CREATE TABLE IF NOT EXISTS hr_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES hr_campaigns(id) ON DELETE CASCADE,
  applicant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_stage hr_application_stage_type NOT NULL DEFAULT 'applied',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, applicant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_applications_campaign ON hr_applications (campaign_id);
CREATE INDEX IF NOT EXISTS idx_hr_applications_applicant ON hr_applications (applicant_user_id);

CREATE TABLE IF NOT EXISTS hr_application_stage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  from_stage hr_application_stage_type,
  to_stage hr_application_stage_type NOT NULL,
  score INTEGER,
  notes TEXT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_onboarding_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  assignee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status hr_onboarding_item_status_type NOT NULL DEFAULT 'todo',
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_onboarding_items_assignee ON hr_onboarding_items (assignee_user_id);

-- 8. PR Announcements & Broadcast Campaigns
CREATE TABLE IF NOT EXISTS pr_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category pr_announcement_category_type NOT NULL DEFAULT 'General',
  visibility pr_announcement_visibility_type NOT NULL DEFAULT 'public',
  image_url TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  author_name TEXT NOT NULL DEFAULT 'Branch Executive Board',
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pr_announcements_created ON pr_announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS pr_announcement_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES pr_announcements(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID REFERENCES committees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  segment_type TEXT NOT NULL DEFAULT 'all_members',
  status pr_campaign_status_type NOT NULL DEFAULT 'draft',
  scheduled_for TIMESTAMPTZ,
  dispatch_request_id UUID,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pr_campaign_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES pr_campaigns(id) ON DELETE CASCADE,
  dispatch_request_id UUID NOT NULL,
  status TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Media & Design Operations
CREATE TABLE IF NOT EXISTS media_albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  status media_album_status_type NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_album_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES media_albums(id) ON DELETE CASCADE,
  asset_url TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'image',
  caption TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_album_assets_album ON media_album_assets (album_id);

CREATE TABLE IF NOT EXISTS media_coverage_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  media_committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_at TIMESTAMPTZ NOT NULL,
  status media_coverage_status_type NOT NULL DEFAULT 'requested',
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_coverage_committee ON media_coverage_requests (committee_id);

CREATE TABLE IF NOT EXISTS media_coverage_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_request_id UUID NOT NULL REFERENCES media_coverage_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status media_coverage_status_type,
  to_status media_coverage_status_type,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. File Assets Registry (Cloudinary Direct Upload Tracking)
CREATE TABLE IF NOT EXISTS file_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cloudinary_asset_id TEXT NOT NULL UNIQUE,
  cloudinary_public_id TEXT NOT NULL UNIQUE,
  secure_url TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'image',
  format TEXT,
  bytes BIGINT,
  purpose TEXT NOT NULL DEFAULT 'general',
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_assets_owner ON file_assets (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_purpose ON file_assets (purpose);

-- 11. IAM Multi-Role & Refresh Tokens
CREATE TABLE IF NOT EXISTS auth_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  committee_id UUID REFERENCES committees(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_roles_user ON auth_user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_user_roles_scope ON auth_user_roles (scope_type, scope_id);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user ON auth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_family ON auth_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_token_hash ON auth_refresh_tokens (token_hash);

-- 12. Branch Officers & Leadership
CREATE TABLE IF NOT EXISTS branch_officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  season TEXT NOT NULL,
  is_current_season BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url TEXT,
  linkedin_url TEXT,
  email TEXT,
  bio TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branch_officers_season ON branch_officers (season);
CREATE INDEX IF NOT EXISTS idx_branch_officers_active ON branch_officers (is_active);

-- 13. Password Reset OTPs
CREATE TABLE IF NOT EXISTS password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user ON password_reset_otps (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expiry ON password_reset_otps (expires_at);
