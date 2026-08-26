const committeesRepository = require('../repositories/committeesRepository');
const prAnnouncementController = require('./prAnnouncementController');
const mediaAlbumController = require('./mediaAlbumController');

// Standard IEEE Menoufia SB Committees metadata
const DEFAULT_COMMITTEE_DETAILS = {
  ras: {
    description: 'Robotics and Automation Society focused on robotics, embedded systems, and automation workshops.',
    activities: ['Robotics competitions', 'Hardware workshops', 'Automation seminars'],
  },
  ai: {
    description: 'Artificial Intelligence Chapter leading hands-on machine learning, deep learning, and data science projects.',
    activities: ['ML study jams', 'Kaggle hackathons', 'Computer vision workshops'],
  },
  web: {
    description: 'Web Development Committee building digital platforms, modern full-stack web applications, and UI/UX solutions.',
    activities: ['Full-stack bootcamps', 'Hackathons', 'Branch portal development'],
  },
  cyber: {
    description: 'Cybersecurity Committee dedicated to offensive and defensive security, CTFs, and networking security.',
    activities: ['CTF competitions', 'Penetration testing workshops', 'Security audits'],
  },
  hr: {
    description: 'Human Resources Committee managing volunteer recruitment, onboarding, engagement, and talent development.',
    activities: ['Recruitment campaigns', 'Onboarding & training', 'Member evaluations'],
  },
  pr: {
    description: 'Public Relations Committee driving outreach, announcements, partnerships, and external communications.',
    activities: ['Press releases', 'Community outreach', 'Email newsletters'],
  },
  media: {
    description: 'Media & Design Committee producing photography, videography, graphic design, and brand assets.',
    activities: ['Event media coverage', 'Visual identity & branding', 'Video production'],
  },
};

async function listPublicCommittees(req, res, next) {
  try {
    const committees = await committeesRepository.listPublicCommittees();
    const enriched = committees.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      isActive: c.isActive,
      description: DEFAULT_COMMITTEE_DETAILS[c.slug]?.description || `${c.name} of IEEE Menoufia Student Branch`,
      activities: DEFAULT_COMMITTEE_DETAILS[c.slug]?.activities || ['Workshops', 'Projects', 'Community sessions'],
    }));

    return res.status(200).json({
      committees: enriched,
    });
  } catch (error) {
    return next(error);
  }
}

const officerRepository = require('../repositories/officerRepository');

async function listPublicOfficers(req, res, next) {
  try {
    const { season } = req.query;
    const officers = await officerRepository.listPublicOfficers({ season });
    return res.status(200).json({
      season: season || (officers[0]?.season || null),
      count: officers.length,
      officers,
    });
  } catch (error) {
    return next(error);
  }
}

async function listPublicSeasons(req, res, next) {
  try {
    const seasons = await officerRepository.listSeasons();
    return res.status(200).json({
      seasons,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listPublicCommittees,
  listPublicAnnouncements: prAnnouncementController.listPublicAnnouncements,
  listPublicAlbums: mediaAlbumController.listPublicAlbums,
  listPublicOfficers,
  listPublicSeasons,
};
