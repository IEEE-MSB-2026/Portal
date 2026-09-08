-- ============================================================================
-- Migration: 002_seed_data.sql
-- Description: System Seed Data for IEEE Menoufia Student Branch Portal
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Core Technical & Operational Committees
-- ----------------------------------------------------------------------------
INSERT INTO committees (id, slug, name, description, is_active) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ai', 'Artificial Intelligence', 'Exploring machine learning, deep learning, and intelligent algorithms.', TRUE),
  ('22222222-2222-4222-8222-222222222222', 'ras', 'Robotics & Automation Society', 'Building autonomous robots, embedded hardware, and automated systems.', TRUE),
  ('33333333-3333-4333-8333-333333333333', 'web', 'Web Development', 'Modern full-stack web engineering, APIs, and scalable architectures.', TRUE),
  ('44444444-4444-4444-8444-444444444444', 'cyber', 'Cybersecurity', 'Defensive security, ethical hacking, cryptography, and network defense.', TRUE),
  ('32323232-3232-4323-8323-323232323232', 'hr', 'Human Resources', 'Member recruitment, onboarding, talent retention, and chapter operations.', TRUE),
  ('55555555-5555-4555-8555-555555555555', 'pr', 'Public Relations', 'Community engagement, sponsorships, event marketing, and broadcasts.', TRUE),
  ('66666666-6666-4666-8666-666666666666', 'media', 'Media & Design', 'Visual identity, creative photography, video production, and branding.', TRUE),
  ('77777777-7777-4777-8777-777777777777', 'oc', 'Operations & Logistics (OC)', 'Event logistics, venue planning, crowd management, live check-ins, and ground operations.', TRUE)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- ----------------------------------------------------------------------------
-- 2. Initial System Administrator User
-- Email: admin@ieeemsb.org
-- Initial Password: 'P@$$w0rd'
-- ----------------------------------------------------------------------------
INSERT INTO users (
  id,
  email,
  password_hash,
  name,
  default_role,
  default_scope_type,
  default_scope_id,
  is_active,
  is_email_verified,
  auth_provider
) VALUES (
  '11111111-0000-4000-8000-000000000001',
  'admin@ieeemsb.org',
  '9830f4859edcc21867e9685489e5c6d4:35b2ebdae477b7e1306ac599daed7f0110ef97043f60ed874fce7df2278612a890feeea487414c20b95efed14f803c00998ccaa656ab7528609de8cea8a0283d',
  'Branch Administrator',
  'admin',
  'global',
  'global',
  TRUE,
  TRUE,
  'local'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  default_role = EXCLUDED.default_role,
  default_scope_type = EXCLUDED.default_scope_type,
  default_scope_id = EXCLUDED.default_scope_id,
  is_email_verified = TRUE,
  auth_provider = 'local';

-- ----------------------------------------------------------------------------
-- 3. Initial Global Admin Role Assignment
-- ----------------------------------------------------------------------------
INSERT INTO auth_user_roles (
  id,
  user_id,
  role,
  scope_type,
  scope_id,
  committee_id,
  is_active
) VALUES (
  'c1111111-1111-4111-8111-111111111111',
  '11111111-0000-4000-8000-000000000001',
  'admin',
  'global',
  'global',
  NULL,
  TRUE
)
ON CONFLICT (id) DO NOTHING;
