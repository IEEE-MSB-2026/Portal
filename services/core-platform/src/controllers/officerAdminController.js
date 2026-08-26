const officerRepository = require('../repositories/officerRepository');

async function createOfficer(req, res, next) {
  try {
    const { name, role, season, isCurrentSeason, avatarUrl, linkedinUrl, email, bio, displayOrder } = req.body;
    if (!name || !role || !season) {
      return res.status(400).json({ error: 'name, role, and season are required' });
    }

    const officer = await officerRepository.createOfficer({
      name,
      role,
      season,
      isCurrentSeason,
      avatarUrl,
      linkedinUrl,
      email,
      bio,
      displayOrder,
    });

    return res.status(201).json({
      message: 'Branch officer created successfully',
      officer,
    });
  } catch (error) {
    if (error.message && error.message.includes('Invalid season format')) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
}

async function updateOfficer(req, res, next) {
  try {
    const { id } = req.params;
    const officer = await officerRepository.updateOfficer(id, req.body);
    if (!officer) {
      return res.status(404).json({ error: 'Branch officer not found' });
    }
    return res.status(200).json({
      message: 'Branch officer updated successfully',
      officer,
    });
  } catch (error) {
    if (error.message && error.message.includes('Invalid season format')) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
}

async function deleteOfficer(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await officerRepository.deleteOfficer(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Branch officer not found' });
    }
    return res.status(200).json({
      message: 'Branch officer deleted successfully',
      id: deleted.id,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createOfficer,
  updateOfficer,
  deleteOfficer,
};
