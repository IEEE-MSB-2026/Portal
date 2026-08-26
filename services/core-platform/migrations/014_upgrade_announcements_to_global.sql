-- Migration: 014_upgrade_announcements_to_global.sql
-- Description: Upgrade pr_announcements to be purely global branch official announcements, and retire committee_announcements

-- 1. Drop old committee_announcements table
DROP TABLE IF EXISTS committee_announcements;

-- 2. Drop committee foreign key constraint and committee_id column
ALTER TABLE pr_announcements DROP CONSTRAINT IF EXISTS pr_announcements_committee_id_fkey;
ALTER TABLE pr_announcements DROP COLUMN IF EXISTS committee_id;

ALTER TABLE pr_announcements
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT 'Branch Executive Board';

-- 3. Create optimized indexes for public feeds and categories
CREATE INDEX IF NOT EXISTS idx_pr_announcements_pinned_created
  ON pr_announcements (is_pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL AND visibility = 'public'::pr_announcement_visibility_type;

CREATE INDEX IF NOT EXISTS idx_pr_announcements_category
  ON pr_announcements (category, created_at DESC)
  WHERE deleted_at IS NULL AND visibility = 'public'::pr_announcement_visibility_type;

-- 4. Seed initial official announcements for Season 2025/2026
INSERT INTO pr_announcements (
  id,
  title,
  body,
  category,
  image_url,
  is_pinned,
  author_name,
  visibility,
  created_by_user_ref_id,
  updated_by_user_ref_id,
  created_at
)
SELECT
  'a0000001-0000-4000-8000-000000000001',
  'Welcome to Season 2025/2026 — Inspiring, Innovating, Connecting',
  'We are thrilled to officially inaugurate the 2025/2026 academic season for IEEE Menoufia Student Branch! This year brings expanded technical bootcamps in robotics and artificial intelligence, new industry partnerships, and our flagship Menoufia Tech Summit.',
  'General',
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&auto=format&fit=crop&q=80',
  TRUE,
  'Branch Executive Board',
  'public'::pr_announcement_visibility_type,
  u.id,
  u.id,
  NOW() - INTERVAL '1 day'
FROM users_ref u
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  category = EXCLUDED.category,
  image_url = EXCLUDED.image_url,
  is_pinned = EXCLUDED.is_pinned,
  author_name = EXCLUDED.author_name,
  visibility = EXCLUDED.visibility;

INSERT INTO pr_announcements (
  id,
  title,
  body,
  category,
  image_url,
  is_pinned,
  author_name,
  visibility,
  created_by_user_ref_id,
  updated_by_user_ref_id,
  created_at
)
SELECT
  'a0000001-0000-4000-8000-000000000002',
  'Menoufia Tech Summit 2026 Early Bird Passes Open',
  'Registration is officially live for Menoufia Tech Summit 2026. Join over 30 keynote speakers, hackathon finalists, and technology leaders at the Main University Auditorium this coming September.',
  'Event',
  'https://images.unsplash.com/photo-1511578314322-379afb476865?w=1200&auto=format&fit=crop&q=80',
  TRUE,
  'PR & Communications Team',
  'public'::pr_announcement_visibility_type,
  u.id,
  u.id,
  NOW() - INTERVAL '2 days'
FROM users_ref u
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  category = EXCLUDED.category,
  image_url = EXCLUDED.image_url,
  is_pinned = EXCLUDED.is_pinned,
  author_name = EXCLUDED.author_name,
  visibility = EXCLUDED.visibility;

INSERT INTO pr_announcements (
  id,
  title,
  body,
  category,
  image_url,
  is_pinned,
  author_name,
  visibility,
  created_by_user_ref_id,
  updated_by_user_ref_id,
  created_at
)
SELECT
  'a0000001-0000-4000-8000-000000000003',
  'Annual Committee Recruitment Drive: Join Our 7 Domains',
  'Applications are now open for student engineers and creatives looking to join our specialized committees: RAS, AI, Web, Cyber, HR, PR, and Media. Build practical projects and lead campus initiatives.',
  'Recruitment',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&auto=format&fit=crop&q=80',
  FALSE,
  'Human Resources Committee',
  'public'::pr_announcement_visibility_type,
  u.id,
  u.id,
  NOW() - INTERVAL '3 days'
FROM users_ref u
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  category = EXCLUDED.category,
  image_url = EXCLUDED.image_url,
  is_pinned = EXCLUDED.is_pinned,
  author_name = EXCLUDED.author_name,
  visibility = EXCLUDED.visibility;

INSERT INTO pr_announcements (
  id,
  title,
  body,
  category,
  image_url,
  is_pinned,
  author_name,
  visibility,
  created_by_user_ref_id,
  updated_by_user_ref_id,
  created_at
)
SELECT
  'a0000001-0000-4000-8000-000000000004',
  'IEEE Extreme Programming Bootcamp & CTF Qualifications',
  'Cybersecurity and Web Development teams are co-hosting a 4-week intensive competitive programming and security workshop preparing teams for international IEEE competitions.',
  'Technical',
  'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&auto=format&fit=crop&q=80',
  FALSE,
  'Technical Societies & Chapters',
  'public'::pr_announcement_visibility_type,
  u.id,
  u.id,
  NOW() - INTERVAL '4 days'
FROM users_ref u
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  category = EXCLUDED.category,
  image_url = EXCLUDED.image_url,
  is_pinned = EXCLUDED.is_pinned,
  author_name = EXCLUDED.author_name,
  visibility = EXCLUDED.visibility;
