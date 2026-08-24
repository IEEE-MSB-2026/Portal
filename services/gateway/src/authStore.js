// In-memory + extensible User Store with pre-configured demo personas for easy testing
const DEMO_USERS = [
  {
    id: 'admin-1',
    email: 'admin@ieee.local',
    password: 'password123',
    name: 'IEEE Branch Chair (Admin)',
    role: 'admin',
    scopeType: 'global',
    scopeId: 'global',
    committeeId: null,
  },
  {
    id: 'officer-1',
    email: 'officer@ieee.local',
    password: 'password123',
    name: 'ExCom Vice Chair',
    role: 'officer',
    scopeType: 'global',
    scopeId: 'global',
    committeeId: null,
  },
  {
    id: 'lead-ras-1',
    email: 'lead.ras@ieee.local',
    password: 'password123',
    name: 'RAS Committee Lead',
    role: 'lead',
    scopeType: 'committee',
    scopeId: '11111111-1111-4111-8111-111111111111',
    committeeId: '11111111-1111-4111-8111-111111111111',
    committeeName: 'RAS',
  },
  {
    id: 'lead-ai-1',
    email: 'lead.ai@ieee.local',
    password: 'password123',
    name: 'AI Committee Lead',
    role: 'lead',
    scopeType: 'committee',
    scopeId: '11111111-1111-4111-8111-111111111111',
    committeeId: '11111111-1111-4111-8111-111111111111',
    committeeName: 'AI',
  },
  {
    id: 'lead-hr-1',
    email: 'lead.hr@ieee.local',
    password: 'password123',
    name: 'HR Committee Lead',
    role: 'lead',
    scopeType: 'committee',
    scopeId: '22222222-2222-4222-8222-222222222222',
    committeeId: '22222222-2222-4222-8222-222222222222',
    committeeName: 'HR',
  },
  {
    id: 'lead-pr-1',
    email: 'lead.pr@ieee.local',
    password: 'password123',
    name: 'PR Committee Lead',
    role: 'lead',
    scopeType: 'committee',
    scopeId: '33333333-3333-4333-8333-333333333333',
    committeeId: '33333333-3333-4333-8333-333333333333',
    committeeName: 'PR',
  },
  {
    id: 'lead-media-1',
    email: 'lead.media@ieee.local',
    password: 'password123',
    name: 'Media Committee Lead',
    role: 'lead',
    scopeType: 'committee',
    scopeId: '44444444-4444-4444-8444-444444444444',
    committeeId: '44444444-4444-4444-8444-444444444444',
    committeeName: 'Media',
  },
  {
    id: 'publisher-1',
    email: 'publisher@ieee.local',
    password: 'password123',
    name: 'Content Publisher',
    role: 'publisher',
    scopeType: 'global',
    scopeId: 'global',
    committeeId: null,
  },
  {
    id: 'member-ai-1',
    email: 'member.ai@ieee.local',
    password: 'password123',
    name: 'AI Active Member',
    role: 'member',
    scopeType: 'committee',
    scopeId: '11111111-1111-4111-8111-111111111111',
    committeeId: '11111111-1111-4111-8111-111111111111',
    committeeName: 'AI',
  },
  {
    id: 'scanner-1',
    email: 'scanner@ieee.local',
    password: 'password123',
    name: 'Event Check-in Scanner',
    role: 'event_scanner',
    scopeType: 'global',
    scopeId: 'global',
    committeeId: null,
  },
];

const usersByEmail = new Map();
DEMO_USERS.forEach((u) => usersByEmail.set(u.email, u));

function findUserByEmail(email) {
  return usersByEmail.get(email?.toLowerCase());
}

function findUserById(id) {
  return Array.from(usersByEmail.values()).find((u) => u.id === id);
}

function registerUser({ email, password, name, role = 'member', committeeId = null }) {
  const normalizedEmail = email.toLowerCase();
  if (usersByEmail.has(normalizedEmail)) {
    throw new Error('User with this email already exists');
  }

  const id = `user-${Date.now()}`;
  const newUser = {
    id,
    email: normalizedEmail,
    password,
    name,
    role,
    scopeType: committeeId ? 'committee' : 'global',
    scopeId: committeeId || 'global',
    committeeId,
  };

  usersByEmail.set(normalizedEmail, newUser);
  return newUser;
}

module.exports = {
  DEMO_USERS,
  findUserByEmail,
  findUserById,
  registerUser,
};
