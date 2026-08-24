INSERT INTO committees (id, slug, name, is_active) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ai', 'Artificial Intelligence', TRUE),
  ('22222222-2222-4222-8222-222222222222', 'ras', 'Robotics & Automation Society', TRUE),
  ('33333333-3333-4333-8333-333333333333', 'web', 'Web Development', TRUE),
  ('44444444-4444-4444-8444-444444444444', 'cyber', 'Cybersecurity', TRUE),
  ('32323232-3232-4323-8323-323232323232', 'hr', 'Human Resources', TRUE),
  ('55555555-5555-4555-8555-555555555555', 'pr', 'Public Relations', TRUE),
  ('66666666-6666-4666-8666-666666666666', 'media', 'Media & Design', TRUE)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

INSERT INTO users_ref (id, external_user_id, email) VALUES
  ('a1111111-1111-4111-8111-111111111111', 'admin-1', 'admin@ieee.local'),
  ('a2222222-2222-4222-8222-222222222222', 'lead-ai-1', 'lead.ai@ieee.local'),
  ('a3333333-3333-4333-8333-333333333333', 'member-ai-1', 'member.ai@ieee.local'),
  ('a4444444-4444-4444-8444-444444444444', 'lead-hr-1', 'lead.hr@ieee.local'),
  ('a5555555-5555-4555-8555-555555555555', 'applicant-1', 'applicant@ieee.local')
ON CONFLICT (external_user_id) DO UPDATE SET
  email = EXCLUDED.email;

INSERT INTO committee_memberships (id, committee_id, user_ref_id, role_in_committee)
SELECT
  'b1111111-1111-4111-8111-111111111111'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  u.id,
  'lead'::role_in_committee_type
FROM users_ref u WHERE u.external_user_id = 'lead-ai-1'
ON CONFLICT (committee_id, user_ref_id) DO NOTHING;

INSERT INTO committee_memberships (id, committee_id, user_ref_id, role_in_committee)
SELECT
  'b2222222-2222-4222-8222-222222222222'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  u.id,
  'member'::role_in_committee_type
FROM users_ref u WHERE u.external_user_id = 'member-ai-1'
ON CONFLICT (committee_id, user_ref_id) DO NOTHING;

INSERT INTO committee_memberships (id, committee_id, user_ref_id, role_in_committee)
SELECT
  'b3333333-3333-4333-8333-333333333333'::uuid,
  '32323232-3232-4323-8323-323232323232'::uuid,
  u.id,
  'lead'::role_in_committee_type
FROM users_ref u WHERE u.external_user_id = 'lead-hr-1'
ON CONFLICT (committee_id, user_ref_id) DO NOTHING;
