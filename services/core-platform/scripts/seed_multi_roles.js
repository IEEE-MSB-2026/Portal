const { getPool, closePool } = require('../src/db/pool');
const logger = require('../src/utils/logger');

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ensure all committees exist with their accurate names
    console.log('Upserting committees...');
    await client.query(`
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
    `);

    // Ensure all default users exist
    console.log('Upserting personas in users table...');
    await client.query(`
      INSERT INTO users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id) VALUES
        ('11111111-0000-4000-8000-000000000001', 'admin@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'IEEE Branch Chair (Admin)', 'admin', 'global', 'global'),
        ('11111111-0000-4000-8000-000000000002', 'officer@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'ExCom Vice Chair', 'officer', 'global', 'global'),
        ('11111111-0000-4000-8000-000000000003', 'lead.ai@ieee.local', '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683', 'Lead AI User', 'lead', 'committee', '11111111-1111-4111-8111-111111111111'),
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
    `);

    // Ensure committee memberships
    console.log('Upserting committee memberships...');
    await client.query(`
      INSERT INTO committee_memberships (id, committee_id, user_id, role_in_committee) VALUES
        ('b1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000003', 'lead'),
        ('b1111111-1111-4111-8111-323232323232', '32323232-3232-4323-8323-323232323232', '11111111-0000-4000-8000-000000000003', 'member'),
        ('b2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000009', 'member'),
        ('b2222222-2222-4222-8222-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-0000-4000-8000-000000000009', 'member'),
        ('b3333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-0000-4000-8000-000000000004', 'lead'),
        ('b4444444-4444-4444-8444-444444444444', '32323232-3232-4323-8323-323232323232', '11111111-0000-4000-8000-000000000005', 'lead'),
        ('b5555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', '11111111-0000-4000-8000-000000000006', 'lead'),
        ('b6666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', '11111111-0000-4000-8000-000000000007', 'lead')
      ON CONFLICT (committee_id, user_id) DO UPDATE SET role_in_committee = EXCLUDED.role_in_committee;
    `);

    // Ensure IAM auth_user_roles
    console.log('Upserting auth_user_roles...');
    await client.query(`
      INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id, is_active) VALUES
        ('c1111111-1111-4111-8111-111111111111', '11111111-0000-4000-8000-000000000001', 'admin', 'global', 'global', NULL, TRUE),
        ('c2222222-2222-4222-8222-111111111111', '11111111-0000-4000-8000-000000000002', 'officer', 'global', 'global', NULL, TRUE),
        -- lead.ai has Lead in AI + Member in HR
        ('c3333333-3333-4333-8333-111111111111', '11111111-0000-4000-8000-000000000003', 'lead', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', TRUE),
        ('c3333333-3333-4333-8333-323232323232', '11111111-0000-4000-8000-000000000003', 'member', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232', TRUE),
        ('c4444444-4444-4444-8444-111111111111', '11111111-0000-4000-8000-000000000004', 'lead', 'committee', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', TRUE),
        ('c5555555-5555-4555-8555-111111111111', '11111111-0000-4000-8000-000000000005', 'lead', 'committee', '32323232-3232-4323-8323-323232323232', '32323232-3232-4323-8323-323232323232', TRUE),
        ('c6666666-6666-4666-8666-111111111111', '11111111-0000-4000-8000-000000000006', 'lead', 'committee', '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', TRUE),
        ('c7777777-7777-4777-8777-111111111111', '11111111-0000-4000-8000-000000000007', 'lead', 'committee', '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', TRUE),
        ('c8888888-8888-4888-8888-111111111111', '11111111-0000-4000-8000-000000000008', 'publisher', 'global', 'global', NULL, TRUE),
        -- member.ai has Member in AI + Member in RAS
        ('c9999999-9999-4999-8999-111111111111', '11111111-0000-4000-8000-000000000009', 'member', 'committee', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', TRUE),
        ('c9999999-9999-4999-8999-222222222222', '11111111-0000-4000-8000-000000000009', 'member', 'committee', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', TRUE),
        ('cbbbbbbb-bbbb-4bbb-8bbb-111111111111', '11111111-0000-4000-8000-000000000011', 'event_scanner', 'global', 'global', NULL, TRUE)
      ON CONFLICT (user_id, role, scope_type, scope_id) DO UPDATE SET
        committee_id = EXCLUDED.committee_id,
        is_active = TRUE;
    `);

    await client.query('COMMIT');
    console.log('✓ All committees, personas, and multi-roles successfully verified and seeded!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(() => process.exit(1));
