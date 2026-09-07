-- Migration: 002_seed_initial_data.sql
-- Description: Seed initial committees, deterministic persona users, role assignments, officers, and initial records.

-- 1. Default Committees
INSERT INTO committees (id, slug, name, description, is_active) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ai', 'Artificial Intelligence', 'Exploring machine learning, deep learning, and intelligent algorithms.', TRUE),
  ('22222222-2222-4222-8222-222222222222', 'ras', 'Robotics & Automation Society', 'Building autonomous robots, embedded hardware, and automated systems.', TRUE),
  ('33333333-3333-4333-8333-333333333333', 'web', 'Web Development', 'Modern full-stack web engineering, APIs, and scalable architectures.', TRUE),
  ('44444444-4444-4444-8444-444444444444', 'cyber', 'Cybersecurity', 'Defensive security, ethical hacking, cryptography, and network defense.', TRUE),
  ('32323232-3232-4323-8323-323232323232', 'hr', 'Human Resources', 'Member recruitment, onboarding, talent retention, and chapter operations.', TRUE),
  ('55555555-5555-4555-8555-555555555555', 'pr', 'Public Relations', 'Community engagement, sponsorships, event marketing, and broadcasts.', TRUE),
  ('66666666-6666-4666-8666-666666666666', 'media', 'Media & Design', 'Visual identity, creative photography, video production, and branding.', TRUE)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- 2. Seed Default Personas (Password: 'password123')
-- Hash: 48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683
INSERT INTO users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id) VALUES
  ('11111111-0000-4000-8000-000000000001', 'admin@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'IEEE Branch Chair (Admin)', 'admin', 'global', 'global'),
  ('11111111-0000-4000-8000-000000000002', 'officer@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'ExCom Vice Chair', 'officer', 'global', 'global'),
  ('11111111-0000-4000-8000-000000000003', 'lead.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'AI Committee Lead', 'lead', 'committee', '11111111-1111-4111-8111-111111111111'),
  ('11111111-0000-4000-8000-000000000004', 'lead.ras@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'RAS Committee Lead', 'lead', 'committee', '22222222-2222-4222-8222-222222222222'),
  ('11111111-0000-4000-8000-000000000005', 'lead.hr@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'HR Committee Lead', 'lead', 'committee', '32323232-3232-4323-8323-323232323232'),
  ('11111111-0000-4000-8000-000000000006', 'lead.pr@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'PR Committee Lead', 'lead', 'committee', '55555555-5555-4555-8555-555555555555'),
  ('11111111-0000-4000-8000-000000000007', 'lead.media@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Media Committee Lead', 'lead', 'committee', '66666666-6666-4666-8666-666666666666'),
  ('11111111-0000-4000-8000-000000000008', 'publisher@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Content Publisher', 'publisher', 'global', 'global'),
  ('11111111-0000-4000-8000-000000000009', 'member.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'AI Active Member', 'member', 'committee', '11111111-1111-4111-8111-111111111111'),
  ('11111111-0000-4000-8000-000000000010', 'applicant@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Prospective Applicant', NULL, NULL, NULL),
  ('11111111-0000-4000-8000-000000000011', 'scanner@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Event Checkin Scanner', 'event_scanner', 'global', 'global')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  default_role = EXCLUDED.default_role,
  default_scope_type = EXCLUDED.default_scope_type,
  default_scope_id = EXCLUDED.default_scope_id;

-- 3. Seed Committee Memberships
INSERT INTO committee_memberships (id, committee_id, user_id, role_in_committee) VALUES
  ('b1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000003', 'lead'),
  ('b2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000009', 'member'),
  ('b3333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-0000-4000-8000-000000000004', 'lead'),
  ('b4444444-4444-4444-8444-444444444444', '32323232-3232-4323-8323-323232323232', '11111111-0000-4000-8000-000000000005', 'lead'),
  ('b5555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', '11111111-0000-4000-8000-000000000006', 'lead'),
  ('b6666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', '11111111-0000-4000-8000-000000000007', 'lead')
ON CONFLICT (committee_id, user_id) DO NOTHING;

-- 4. Seed IAM User Roles
INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id) VALUES
  ('c1111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000001', 'admin', 'global', 'global', NULL),
  ('c2222222-2222-4222-8222-111111111111', '11111111-0000-4000-8000-000000000002', 'officer', 'global', 'global', NULL),
  ('c3333333-3333-4333-8333-111111111111', '11111111-0000-4000-8000-000000000003', 'lead', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c3333333-3333-4333-8333-222222222222', '11111111-0000-4000-8000-000000000003', 'member', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c4444444-4444-4444-8444-111111111111', '11111111-0000-4000-8000-000000000004', 'lead', 'committee', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
  ('c5555555-5555-4555-8555-111111111111', '11111111-0000-4000-8000-000000000005', 'lead', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232'),
  ('c6666666-6666-4666-8666-111111111111', '11111111-0000-4000-8000-000000000006', 'lead', 'committee', '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'),
  ('c7777777-7777-4777-8777-111111111111', '11111111-0000-4000-8000-000000000007', 'lead', 'committee', '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666'),
  ('c8888888-8888-4888-8888-111111111111', '11111111-0000-4000-8000-000000000008', 'publisher', 'global', 'global', NULL),
  ('c9999999-9999-4999-8999-111111111111', '11111111-0000-4000-8000-000000000009', 'member', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('cbbbbbbb-bbbb-4bbb-8bbb-111111111111', '11111111-0000-4000-8000-000000000011', 'event_scanner', 'global', 'global', NULL)
ON CONFLICT (id) DO NOTHING;

-- 5. Seed Initial Tasks
INSERT INTO tasks (id, committee_id, title, description, status, created_by_user_id, assignee_user_id, due_date) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'Prepare Computer Vision Workshop Slides', 'Draft the slides for week 1 introductory session on convolutional neural networks.', 'todo', '11111111-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000009', NOW() + INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;

-- 6. Seed Initial Global Announcements
INSERT INTO pr_announcements (id, title, body, category, visibility, author_name, author_user_id, created_by_user_id, is_pinned) VALUES
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Welcome to IEEE Menoufia Student Branch 2026!', 'We are excited to launch the new unified digital portal for all members and committee leads.', 'General', 'public', 'Branch Executive Board', '11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 7. Seed Branch Officers
INSERT INTO branch_officers (id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, is_active) VALUES
  ('d1111111-1111-4111-8111-111111111111', 'Yousef Abdelwahed', 'Branch Chair', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/yousef-abdelwahed', 'chair@ieee.menoufia.org', 'Leading IEEE MSB into a new era of engineering excellence, innovation, and digital transformation.', 1, TRUE),
  ('d2222222-2222-4222-8222-222222222222', 'Ahmed Mansour', 'Vice Chair', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/ahmed-mansour', 'vicechair@ieee.menoufia.org', 'Overseeing chapter technical committees and student project incubators.', 2, TRUE),
  ('d3333333-3333-4333-8333-333333333333', 'Salma Ezzat', 'General Secretary', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/salma-ezzat', 'secretary@ieee.menoufia.org', 'Managing branch operations, communications, and official documentation.', 3, TRUE),
  ('d4444444-4444-4444-8444-444444444444', 'Omar Farouk', 'Treasurer', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/omar-farouk', 'treasurer@ieee.menoufia.org', 'Managing financial budgets, sponsorships, and resource allocations.', 4, TRUE),
  ('d5555555-5555-4555-8555-555555555555', 'Nourhan Ali', 'Head of Human Resources', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/nourhan-ali', 'hr@ieee.menoufia.org', 'Driving talent recruitment, onboarding, and community culture.', 5, TRUE),
  ('d6666666-6666-4666-8666-111111111111', 'Khaled Ibrahim', 'Past Branch Chair', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/khaled-ibrahim', 'pastchair2024@ieee.menoufia.org', 'Chair of the 2024/2025 Executive Committee.', 1, TRUE),
  ('d7777777-7777-4777-8777-111111111111', 'Mariam Tarek', 'Past Vice Chair', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/mariam-tarek', 'pastvice2024@ieee.menoufia.org', 'Vice Chair of the 2024/2025 Executive Committee.', 2, TRUE),
  ('d8888888-8888-4888-8888-111111111111', 'Mostafa Kamal', 'Past Secretary', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/mostafa-kamal', 'pastsec2024@ieee.menoufia.org', 'Secretary of the 2024/2025 Executive Committee.', 3, TRUE)
ON CONFLICT (id) DO NOTHING;
