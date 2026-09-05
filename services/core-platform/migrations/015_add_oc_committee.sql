-- Migration: 015_add_oc_committee.sql
-- Description: Seed Operations Committee (OC), persona lead user, and committee membership.

-- 1. Seed OC Committee
INSERT INTO committees (id, slug, name, description, is_active) VALUES
  ('77777777-7777-4777-8777-777777777777', 'oc', 'Operations & Logistics (OC)', 'Event logistics, venue planning, crowd management, live check-ins, and ground operations.', TRUE)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- 2. Seed OC Lead Persona User (Password: 'password123')
INSERT INTO users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id) VALUES
  ('11111111-0000-4000-8000-000000000012', 'lead.oc@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Operations Committee Lead', 'lead', 'committee', '77777777-7777-4777-8777-777777777777')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  default_role = EXCLUDED.default_role,
  default_scope_type = EXCLUDED.default_scope_type,
  default_scope_id = EXCLUDED.default_scope_id;

-- 3. Seed OC Committee Membership
INSERT INTO committee_memberships (id, committee_id, user_id, role_in_committee) VALUES
  ('b7777777-7777-4777-8777-777777777777', '77777777-7777-4777-8777-777777777777', '11111111-0000-4000-8000-000000000012', 'lead')
ON CONFLICT (committee_id, user_id) DO NOTHING;
