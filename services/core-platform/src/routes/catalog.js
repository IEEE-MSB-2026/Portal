const coreRoutesCatalog = [
  { method: 'GET', path: '/core/me/dashboard', description: 'Get member dashboard data' },
  { method: 'GET', path: '/core/committees/:committeeId/workspace', description: 'Get committee workspace summary' },
  { method: 'POST', path: '/core/committees/:committeeId/tasks', description: 'Create task in committee scope' },
  { method: 'PATCH', path: '/core/tasks/:taskId/status', description: 'Update task status' },
  { method: 'GET', path: '/core/routes', description: 'List core route contracts' },
];

module.exports = { coreRoutesCatalog };
