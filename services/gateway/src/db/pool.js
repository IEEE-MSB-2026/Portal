const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function initPgMemPool() {
  const { newDb } = require('pg-mem');
  const db = newDb();

  // Register common PostgreSQL functions
  db.public.registerFunction({
    name: 'gen_random_uuid',
    args: [],
    returns: db.public.uuid,
    implementation: () => require('crypto').randomUUID(),
  });

  // Create tables
  db.public.none(`
    CREATE TABLE IF NOT EXISTS committees (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  db.public.none(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT NOT NULL,
      avatar_url TEXT,
      membership_id TEXT,
      default_role TEXT,
      default_scope_type TEXT,
      default_scope_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      email_verification_token_hash TEXT DEFAULT NULL,
      email_verification_expires_at TIMESTAMPTZ DEFAULT NULL,
      email_verification_sent_at TIMESTAMPTZ DEFAULT NULL,
      google_id TEXT UNIQUE DEFAULT NULL,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  db.public.none(`
    CREATE TABLE IF NOT EXISTS auth_user_roles (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      committee_id UUID REFERENCES committees(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, role, scope_type, scope_id)
    );
  `);

  db.public.none(`
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      family_id UUID NOT NULL,
      is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_otps (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      otp_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      is_used BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed committees
  db.public.none(`
    INSERT INTO committees (id, name, slug) VALUES
      ('11111111-1111-4111-8111-111111111111', 'Artificial Intelligence', 'ai'),
      ('22222222-2222-4222-8222-222222222222', 'Robotics & Automation Society', 'ras'),
      ('32323232-3232-4323-8323-323232323232', 'Human Resources', 'hr'),
      ('55555555-5555-4555-8555-555555555555', 'Public Relations', 'pr'),
      ('66666666-6666-4666-8666-666666666666', 'Media & Marketing', 'media');
  `);

  // Seed personas with deterministic UUIDs
  db.public.none(`
    INSERT INTO users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id, is_email_verified) VALUES
      ('11111111-0000-4000-8000-000000000000', 'admin@ieeemsb.org', '9830f4859edcc21867e9685489e5c6d4:35b2ebdae477b7e1306ac599daed7f0110ef97043f60ed874fce7df2278612a890feeea487414c20b95efed14f803c00998ccaa656ab7528609de8cea8a0283d', 'Branch Administrator', 'admin', 'global', 'global', TRUE),
      ('11111111-0000-4000-8000-000000000001', 'admin@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'IEEE Branch Chair (Admin)', 'admin', 'global', 'global', TRUE),
      ('11111111-0000-4000-8000-000000000002', 'officer@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'ExCom Vice Chair', 'officer', 'global', 'global', TRUE),
      ('11111111-0000-4000-8000-000000000003', 'lead.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'AI Committee Lead', 'lead', 'committee', '11111111-1111-4111-8111-111111111111', TRUE),
      ('11111111-0000-4000-8000-000000000004', 'lead.ras@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'RAS Committee Lead', 'lead', 'committee', '22222222-2222-4222-8222-222222222222', TRUE),
      ('11111111-0000-4000-8000-000000000005', 'lead.hr@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'HR Committee Lead', 'lead', 'committee', '32323232-3232-4323-8323-323232323232', TRUE),
      ('11111111-0000-4000-8000-000000000006', 'lead.pr@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'PR Committee Lead', 'lead', 'committee', '55555555-5555-4555-8555-555555555555', TRUE),
      ('11111111-0000-4000-8000-000000000007', 'lead.media@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Media Committee Lead', 'lead', 'committee', '66666666-6666-4666-8666-666666666666', TRUE),
      ('11111111-0000-4000-8000-000000000008', 'publisher@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Content Publisher', 'publisher', 'global', 'global', TRUE),
      ('11111111-0000-4000-8000-000000000009', 'member.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'AI Active Member', 'member', 'committee', '11111111-1111-4111-8111-111111111111', TRUE),
      ('11111111-0000-4000-8000-000000000010', 'applicant@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'IEEE Applicant', NULL, NULL, NULL, FALSE),
      ('11111111-0000-4000-8000-000000000011', 'scanner@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Event Check-in Scanner', 'event_scanner', 'global', 'global', TRUE);
  `);

  // Seed roles
  db.public.none(`
    INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id) VALUES
      ('c0000000-0000-4000-8000-000000000000', '11111111-0000-4000-8000-000000000000', 'admin', 'global', 'global', NULL),
      ('c1111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000001', 'admin', 'global', 'global', NULL),
      ('c2222222-2222-4222-8222-111111111111', '11111111-0000-4000-8000-000000000002', 'officer', 'global', 'global', NULL),
      ('c3333333-3333-4333-8333-111111111111', '11111111-0000-4000-8000-000000000003', 'lead', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
      ('c3333333-3333-4333-8333-323232323232', '11111111-0000-4000-8000-000000000003', 'member', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232'),
      ('c4444444-4444-4444-8444-111111111111', '11111111-0000-4000-8000-000000000004', 'lead', 'committee', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
      ('c5555555-5555-4555-8555-111111111111', '11111111-0000-4000-8000-000000000005', 'lead', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232'),
      ('c6666666-6666-4666-8666-111111111111', '11111111-0000-4000-8000-000000000006', 'lead', 'committee', '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'),
      ('c7777777-7777-4777-8777-111111111111', '11111111-0000-4000-8000-000000000007', 'lead', 'committee', '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666'),
      ('c8888888-8888-4888-8888-111111111111', '11111111-0000-4000-8000-000000000008', 'publisher', 'global', 'global', NULL),
      ('c9999999-9999-4999-8999-111111111111', '11111111-0000-4000-8000-000000000009', 'member', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
      ('cbbbbbbb-bbbb-4bbb-8bbb-111111111111', '11111111-0000-4000-8000-000000000011', 'event_scanner', 'global', 'global', NULL);
  `);

  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function getPool() {
  if (!pool) {
    if (process.env.GATEWAY_USE_PGMEM === 'true' || (process.env.NODE_ENV === 'test' && process.env.GATEWAY_USE_PGMEM !== 'false')) {
      pool = initPgMemPool();
    } else {
      pool = new Pool({
        connectionString: config.databaseUrl,
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
      });

      pool.on('error', (err) => {
        console.error('[Gateway Database Pool Error]:', err.message);
      });
    }
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  closePool,
};
