const coreRoutesCatalog = [
  { method: 'GET', path: '/core/me/dashboard', description: 'Get member dashboard data' },
  { method: 'GET', path: '/core/committees/:committeeId/workspace', description: 'Get committee workspace summary' },
  { method: 'POST', path: '/core/committees/:committeeId/tasks', description: 'Create task in committee scope' },
  { method: 'PATCH', path: '/core/tasks/:taskId/status', description: 'Update task status' },
  { method: 'GET', path: '/core/committees/:committeeId/resources', description: 'List committee resources' },
  { method: 'POST', path: '/core/committees/:committeeId/resources', description: 'Create committee resource' },
  { method: 'GET', path: '/core/committees/:committeeId/announcements', description: 'List committee announcements' },
  { method: 'POST', path: '/core/committees/:committeeId/announcements', description: 'Create committee announcement' },
  { method: 'GET', path: '/core/committees/:committeeId/memberships', description: 'List committee memberships' },
  { method: 'POST', path: '/core/committees/:committeeId/memberships', description: 'Upsert committee membership' },
  { method: 'DELETE', path: '/core/committees/:committeeId/memberships/:userId', description: 'Remove committee membership' },
  { method: 'GET', path: '/core/routes', description: 'List core route contracts' },
];

module.exports = { coreRoutesCatalog };
