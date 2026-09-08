const { query } = require('../db/pool');

async function getBranchCockpitStats() {
  // 1. Overall Task Metrics across all committees
  const taskSummarySql = `
    SELECT
      COUNT(*)::int AS total_tasks,
      COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_tasks,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tasks,
      COUNT(*) FILTER (WHERE status = 'done')::int AS done_tasks
    FROM tasks
    WHERE is_archived = FALSE AND (committee_id IS NOT NULL OR is_board_task = TRUE)
  `;
  const taskSummaryRes = await query(taskSummarySql);
  const taskSummary = taskSummaryRes.rows[0] || {
    total_tasks: 0,
    todo_tasks: 0,
    in_progress_tasks: 0,
    done_tasks: 0,
  };

  const totalTasks = taskSummary.total_tasks || 0;
  const completedTasks = taskSummary.done_tasks || 0;
  const inProgressTasks = taskSummary.in_progress_tasks || 0;
  const todoTasks = taskSummary.todo_tasks || 0;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // 2. Total active members across committees
  const membersSql = `
    SELECT COUNT(DISTINCT user_id)::int AS total_active_members
    FROM committee_memberships
  `;
  const membersRes = await query(membersSql);
  const totalMembers = membersRes.rows[0]?.total_active_members || 0;

  // 3. Active HR Recruitment pipeline count
  const hrPipelineSql = `
    SELECT COUNT(*)::int AS active_applicants
    FROM hr_applications
    WHERE stage NOT IN ('accepted', 'rejected')
  `;
  let activeApplicants = 0;
  try {
    const hrRes = await query(hrPipelineSql);
    activeApplicants = hrRes.rows[0]?.active_applicants || 0;
  } catch {
    activeApplicants = 0;
  }

  // 4. Per-Committee Statistics across all 8 active committees
  const committeesSql = `
    SELECT
      c.id,
      c.slug,
      c.name,
      c.description,
      c.is_active,
      -- Member count
      COUNT(DISTINCT cm.user_id)::int AS member_count,
      -- Lead details
      u_lead.id AS lead_id,
      u_lead.name AS lead_name,
      u_lead.avatar_url AS lead_avatar,
      u_lead.email AS lead_email,
      -- Committee Tasks
      COUNT(DISTINCT t.id) FILTER (WHERE t.is_archived = FALSE)::int AS comm_total_tasks,
      COUNT(DISTINCT t.id) FILTER (WHERE t.is_archived = FALSE AND t.status = 'todo')::int AS comm_todo_tasks,
      COUNT(DISTINCT t.id) FILTER (WHERE t.is_archived = FALSE AND t.status = 'in_progress')::int AS comm_in_progress_tasks,
      COUNT(DISTINCT t.id) FILTER (WHERE t.is_archived = FALSE AND t.status = 'done')::int AS comm_done_tasks
    FROM committees c
    LEFT JOIN committee_memberships cm ON cm.committee_id = c.id
    LEFT JOIN committee_memberships cm_lead ON cm_lead.committee_id = c.id AND cm_lead.role_in_committee = 'lead'
    LEFT JOIN users u_lead ON u_lead.id = cm_lead.user_id
    LEFT JOIN tasks t ON t.committee_id = c.id
    WHERE c.is_active = TRUE
    GROUP BY c.id, c.slug, c.name, c.description, c.is_active, u_lead.id, u_lead.name, u_lead.avatar_url, u_lead.email
    ORDER BY c.name ASC
  `;
  const committeesRes = await query(committeesSql);

  // 5. Per-committee active recruitment counts (safe join fallback)
  const committeeStats = committeesRes.rows.map((row) => {
    const commTotal = row.comm_total_tasks || 0;
    const commDone = row.comm_done_tasks || 0;
    const commRate = commTotal > 0 ? Math.round((commDone / commTotal) * 100) : 0;

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      memberCount: row.member_count || 0,
      lead: row.lead_id
        ? {
            id: row.lead_id,
            name: row.lead_name,
            avatarUrl: row.lead_avatar,
            email: row.lead_email,
          }
        : null,
      tasks: {
        total: commTotal,
        todo: row.comm_todo_tasks || 0,
        inProgress: row.comm_in_progress_tasks || 0,
        done: commDone,
        completionRate: commRate,
      },
    };
  });

  return {
    kpis: {
      totalTasks,
      completedTasks,
      inProgressTasks,
      todoTasks,
      completionRate,
      totalMembers,
      activeApplicants,
      totalCommittees: committeeStats.length,
    },
    committees: committeeStats,
  };
}

module.exports = {
  getBranchCockpitStats,
};
