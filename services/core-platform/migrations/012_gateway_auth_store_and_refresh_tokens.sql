-- Gateway Auth Users, Multi-Role / Multi-Scope Permissions, and Refresh Tokens

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  default_role TEXT NOT NULL DEFAULT 'member',
  default_scope_type TEXT NOT NULL DEFAULT 'global',
  default_scope_id TEXT NOT NULL DEFAULT 'global',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email);

CREATE TABLE IF NOT EXISTS auth_user_roles (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  committee_id UUID REFERENCES committees(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_roles_user_id ON auth_user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_user_roles_scope ON auth_user_roles (scope_type, scope_id);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_family_id ON auth_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_token_hash ON auth_refresh_tokens (token_hash);

-- Seed default personas with pre-hashed 'password123'
-- Hash: 48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683

INSERT INTO auth_users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id) VALUES
  ('admin-1', 'admin@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'IEEE Branch Chair (Admin)', 'admin', 'global', 'global'),
  ('officer-1', 'officer@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'ExCom Vice Chair', 'officer', 'global', 'global'),
  ('lead-ai-1', 'lead.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'AI Committee Lead', 'lead', 'committee', '11111111-1111-4111-8111-111111111111'),
  ('lead-ras-1', 'lead.ras@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'RAS Committee Lead', 'lead', 'committee', '22222222-2222-4222-8222-222222222222'),
  ('lead-hr-1', 'lead.hr@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'HR Committee Lead', 'lead', 'committee', '32323232-3232-4323-8323-323232323232'),
  ('lead-pr-1', 'lead.pr@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'PR Committee Lead', 'lead', 'committee', '55555555-5555-4555-8555-555555555555'),
  ('lead-media-1', 'lead.media@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Media Committee Lead', 'lead', 'committee', '66666666-6666-4666-8666-666666666666'),
  ('publisher-1', 'publisher@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Content Publisher', 'publisher', 'global', 'global'),
  ('member-ai-1', 'member.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'AI Active Member', 'member', 'committee', '11111111-1111-4111-8111-111111111111'),
  ('applicant-1', 'applicant@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'IEEE Applicant', 'applicant', 'global', 'global'),
  ('scanner-1', 'scanner@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Event Check-in Scanner', 'event_scanner', 'global', 'global')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  default_role = EXCLUDED.default_role,
  default_scope_type = EXCLUDED.default_scope_type,
  default_scope_id = EXCLUDED.default_scope_id;

-- Seed multi-scope roles for personas
INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id) VALUES
  ('c1111111-1111-4111-8111-111111111111', 'admin-1', 'admin', 'global', 'global', NULL),
  ('c1111111-1111-4111-8111-222222222222', 'admin-1', 'member', 'global', 'global', NULL),
  ('c2222222-2222-4222-8222-111111111111', 'officer-1', 'officer', 'global', 'global', NULL),
  ('c2222222-2222-4222-8222-222222222222', 'officer-1', 'member', 'global', 'global', NULL),
  ('c3333333-3333-4333-8333-111111111111', 'lead-ai-1', 'lead', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c3333333-3333-4333-8333-222222222222', 'lead-ai-1', 'member', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c3333333-3333-4333-8333-333333333333', 'lead-ai-1', 'member', 'global', 'global', NULL),
  ('c4444444-4444-4444-8444-111111111111', 'lead-ras-1', 'lead', 'committee', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
  ('c4444444-4444-4444-8444-222222222222', 'lead-ras-1', 'member', 'committee', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
  ('c5555555-5555-4555-8555-111111111111', 'lead-hr-1', 'lead', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232'),
  ('c5555555-5555-4555-8555-222222222222', 'lead-hr-1', 'member', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232'),
  ('c6666666-6666-4666-8666-111111111111', 'lead-pr-1', 'lead', 'committee', '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'),
  ('c6666666-6666-4666-8666-222222222222', 'lead-pr-1', 'member', 'committee', '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'),
  ('c7777777-7777-4777-8777-111111111111', 'lead-media-1', 'lead', 'committee', '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666'),
  ('c7777777-7777-4777-8777-222222222222', 'lead-media-1', 'member', 'committee', '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666'),
  ('c8888888-8888-4888-8888-111111111111', 'publisher-1', 'publisher', 'global', 'global', NULL),
  ('c8888888-8888-4888-8888-222222222222', 'publisher-1', 'member', 'global', 'global', NULL),
  ('c9999999-9999-4999-8999-111111111111', 'member-ai-1', 'member', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c9999999-9999-4999-8999-222222222222', 'member-ai-1', 'member', 'global', 'global', NULL),
  ('caaaaaaa-aaaa-4aaa-8aaa-111111111111', 'scanner-1', 'event_scanner', 'global', 'global', NULL)
ON CONFLICT (user_id, role, scope_type, scope_id) DO UPDATE SET
  is_active = TRUE;
