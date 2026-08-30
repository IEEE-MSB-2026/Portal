const userRepository = require('../repositories/userRepository');

async function assignRole(req, res, next) {
  try {
    const { userId, role, scopeType, scopeId } = req.body || {};
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }

    await userRepository.assignRole({
      userId,
      role,
      scopeType: scopeType || 'global',
      scopeId: scopeId || 'global',
      committeeId: scopeType === 'committee' ? scopeId : null,
    });

    return res.status(200).json({ status: 'ok', userId, role, scopeType, scopeId });
  } catch (err) {
    next(err);
  }
}

async function revokeRole(req, res, next) {
  try {
    const { userId, scopeType, scopeId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await userRepository.revokeRole({
      userId,
      scopeType: scopeType || 'committee',
      scopeId: scopeId || null,
    });

    return res.status(200).json({ status: 'ok', userId, scopeType, scopeId });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  assignRole,
  revokeRole,
};
