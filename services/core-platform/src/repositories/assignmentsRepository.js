const { query, getPool } = require('../db/pool');

async function createAssignment({
  committeeId,
  title,
  description = null,
  dueDate = null,
  maxPoints = 100,
  attachmentUrl = null,
  attachmentName = null,
  createdByUserId,
}) {
  const result = await query(
    `
      INSERT INTO committee_assignments (
        committee_id,
        title,
        description,
        due_date,
        max_points,
        attachment_url,
        attachment_name,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      committeeId,
      title,
      description,
      dueDate,
      maxPoints || 100,
      attachmentUrl,
      attachmentName,
      createdByUserId,
    ]
  );

  return result.rows[0];
}

async function listAssignmentsByCommittee(committeeId, { userId = null } = {}) {
  const result = await query(
    `
      SELECT
        ca.*,
        u.name AS creator_name,
        c.name AS committee_name,
        c.slug AS committee_slug,
        (SELECT COUNT(*)::int FROM assignment_submissions sub WHERE sub.assignment_id = ca.id) AS total_submissions_count,
        sub.id AS my_submission_id,
        sub.file_url AS my_submission_file_url,
        sub.file_name AS my_submission_file_name,
        sub.notes AS my_submission_notes,
        sub.status AS my_submission_status,
        sub.grade AS my_submission_grade,
        sub.feedback AS my_submission_feedback,
        sub.submitted_at AS my_submission_submitted_at
      FROM committee_assignments ca
      LEFT JOIN users u ON u.id = ca.created_by_user_id
      LEFT JOIN committees c ON c.id = ca.committee_id
      LEFT JOIN assignment_submissions sub ON sub.assignment_id = ca.id AND sub.user_id = $2
      WHERE ca.committee_id = $1 AND ca.is_active = TRUE
      ORDER BY ca.created_at DESC
    `,
    [committeeId, userId]
  );

  return result.rows.map((r) => ({
    id: r.id,
    committeeId: r.committee_id,
    committeeName: r.committee_name,
    committeeSlug: r.committee_slug,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    maxPoints: r.max_points,
    attachmentUrl: r.attachment_url,
    attachmentName: r.attachment_name,
    createdByUserId: r.created_by_user_id,
    creatorName: r.creator_name,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalSubmissionsCount: r.total_submissions_count || 0,
    mySubmission: r.my_submission_id ? {
      id: r.my_submission_id,
      fileUrl: r.my_submission_file_url,
      fileName: r.my_submission_file_name,
      notes: r.my_submission_notes,
      status: r.my_submission_status,
      grade: r.my_submission_grade,
      feedback: r.my_submission_feedback,
      submittedAt: r.my_submission_submitted_at,
    } : null,
  }));
}

async function getAssignmentById(assignmentId, { userId = null } = {}) {
  const result = await query(
    `
      SELECT
        ca.*,
        u.name AS creator_name,
        c.name AS committee_name,
        c.slug AS committee_slug,
        (SELECT COUNT(*)::int FROM assignment_submissions sub WHERE sub.assignment_id = ca.id) AS total_submissions_count,
        sub.id AS my_submission_id,
        sub.file_url AS my_submission_file_url,
        sub.file_name AS my_submission_file_name,
        sub.notes AS my_submission_notes,
        sub.status AS my_submission_status,
        sub.grade AS my_submission_grade,
        sub.feedback AS my_submission_feedback,
        sub.submitted_at AS my_submission_submitted_at
      FROM committee_assignments ca
      LEFT JOIN users u ON u.id = ca.created_by_user_id
      LEFT JOIN committees c ON c.id = ca.committee_id
      LEFT JOIN assignment_submissions sub ON sub.assignment_id = ca.id AND sub.user_id = $2
      WHERE ca.id = $1
    `,
    [assignmentId, userId]
  );

  if (!result.rows[0]) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    committeeId: r.committee_id,
    committeeName: r.committee_name,
    committeeSlug: r.committee_slug,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    maxPoints: r.max_points,
    attachmentUrl: r.attachment_url,
    attachmentName: r.attachment_name,
    createdByUserId: r.created_by_user_id,
    creatorName: r.creator_name,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalSubmissionsCount: r.total_submissions_count || 0,
    mySubmission: r.my_submission_id ? {
      id: r.my_submission_id,
      fileUrl: r.my_submission_file_url,
      fileName: r.my_submission_file_name,
      notes: r.my_submission_notes,
      status: r.my_submission_status,
      grade: r.my_submission_grade,
      feedback: r.my_submission_feedback,
      submittedAt: r.my_submission_submitted_at,
    } : null,
  };
}

async function updateAssignment(assignmentId, {
  title,
  description,
  dueDate,
  maxPoints,
  attachmentUrl,
  attachmentName,
}) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (title !== undefined) {
    fields.push(`title = $${idx++}`);
    values.push(title);
  }
  if (description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(description);
  }
  if (dueDate !== undefined) {
    fields.push(`due_date = $${idx++}`);
    values.push(dueDate);
  }
  if (maxPoints !== undefined) {
    fields.push(`max_points = $${idx++}`);
    values.push(maxPoints);
  }
  if (attachmentUrl !== undefined) {
    try {
      const existing = await query('SELECT attachment_url FROM committee_assignments WHERE id = $1', [assignmentId]);
      const oldAttachmentUrl = existing.rows[0]?.attachment_url;
      if (oldAttachmentUrl && oldAttachmentUrl !== attachmentUrl) {
        const fileOutboxRepository = require('./fileOutboxRepository');
        await fileOutboxRepository.queueFileDeletion({
          secureUrl: oldAttachmentUrl,
          resourceType: 'raw',
        });
      }
    } catch {
      // Non-blocking outbox error
    }
    fields.push(`attachment_url = $${idx++}`);
    values.push(attachmentUrl);
  }
  if (attachmentName !== undefined) {
    fields.push(`attachment_name = $${idx++}`);
    values.push(attachmentName);
  }

  fields.push(`updated_at = NOW()`);
  values.push(assignmentId);

  const result = await query(
    `
      UPDATE committee_assignments
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `,
    values
  );

  return result.rows[0] || null;
}

async function deleteAssignment(assignmentId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Retrieve assignment attachment and all cascading submission files before deleting
    const assignRes = await client.query('SELECT attachment_url FROM committee_assignments WHERE id = $1', [assignmentId]);
    const subsRes = await client.query('SELECT file_url FROM assignment_submissions WHERE assignment_id = $1', [assignmentId]);

    const result = await client.query(
      `
        DELETE FROM committee_assignments
        WHERE id = $1
        RETURNING id
      `,
      [assignmentId]
    );

    if (result.rows[0]) {
      const fileOutboxRepository = require('./fileOutboxRepository');

      // Queue assignment attachment for deletion
      if (assignRes.rows[0]?.attachment_url) {
        await fileOutboxRepository.queueFileDeletion({
          secureUrl: assignRes.rows[0].attachment_url,
          resourceType: 'raw',
          client,
        });
      }

      // Queue all child submission files for deletion
      for (const sub of subsRes.rows) {
        if (sub.file_url) {
          await fileOutboxRepository.queueFileDeletion({
            secureUrl: sub.file_url,
            resourceType: 'raw',
            client,
          });
        }
      }
    }

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function upsertSubmission({
  assignmentId,
  userId,
  fileUrl,
  fileName = null,
  notes = null,
}) {
  // If replacing an existing submission, queue the old file for deletion
  try {
    const existing = await query(
      'SELECT file_url FROM assignment_submissions WHERE assignment_id = $1 AND user_id = $2',
      [assignmentId, userId]
    );
    const oldFileUrl = existing.rows[0]?.file_url;
    if (oldFileUrl && oldFileUrl !== fileUrl) {
      const fileOutboxRepository = require('./fileOutboxRepository');
      await fileOutboxRepository.queueFileDeletion({
        secureUrl: oldFileUrl,
        resourceType: 'raw',
      });
    }
  } catch {
    // Non-blocking outbox error
  }

  const result = await query(
    `
      INSERT INTO assignment_submissions (
        assignment_id,
        user_id,
        file_url,
        file_name,
        notes,
        status,
        submitted_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'submitted', NOW(), NOW())
      ON CONFLICT (assignment_id, user_id) DO UPDATE SET
        file_url = EXCLUDED.file_url,
        file_name = EXCLUDED.file_name,
        notes = EXCLUDED.notes,
        status = 'submitted',
        updated_at = NOW()
      RETURNING *
    `,
    [assignmentId, userId, fileUrl, fileName, notes]
  );

  return result.rows[0];
}

async function listSubmissionsForAssignment(assignmentId) {
  const result = await query(
    `
      SELECT
        sub.*,
        u.name AS student_name,
        u.email AS student_email,
        u.avatar_url AS student_avatar_url,
        u.membership_id AS student_membership_id
      FROM assignment_submissions sub
      JOIN users u ON u.id = sub.user_id
      WHERE sub.assignment_id = $1
      ORDER BY sub.submitted_at DESC
    `,
    [assignmentId]
  );

  return result.rows.map((r) => ({
    id: r.id,
    assignmentId: r.assignment_id,
    userId: r.user_id,
    studentName: r.student_name,
    studentEmail: r.student_email,
    studentAvatarUrl: r.student_avatar_url,
    studentMembershipId: r.student_membership_id,
    fileUrl: r.file_url,
    fileName: r.file_name,
    notes: r.notes,
    status: r.status,
    grade: r.grade,
    feedback: r.feedback,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
  }));
}

async function gradeSubmission({
  submissionId,
  grade,
  feedback = null,
  status = 'graded',
}) {
  const result = await query(
    `
      UPDATE assignment_submissions
      SET
        grade = $1,
        feedback = $2,
        status = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `,
    [grade, feedback, status, submissionId]
  );

  return result.rows[0] || null;
}

async function listPendingAssignmentsForUser(userId, committeeIds = []) {
  if (!committeeIds || committeeIds.length === 0) return [];

  const result = await query(
    `
      SELECT
        ca.id,
        ca.committee_id,
        ca.title,
        ca.description,
        ca.due_date,
        ca.max_points,
        ca.attachment_url,
        ca.attachment_name,
        ca.created_at,
        c.name AS committee_name,
        c.slug AS committee_slug,
        sub.id AS submission_id,
        sub.status AS submission_status,
        sub.grade AS submission_grade,
        sub.submitted_at
      FROM committee_assignments ca
      JOIN committees c ON c.id = ca.committee_id
      LEFT JOIN assignment_submissions sub ON sub.assignment_id = ca.id AND sub.user_id = $1
      WHERE ca.committee_id = ANY($2)
        AND ca.is_active = TRUE
        AND (ca.due_date IS NULL OR ca.due_date::date >= CURRENT_DATE OR ca.due_date >= NOW())
      ORDER BY ca.due_date ASC NULLS LAST, ca.created_at DESC
      LIMIT 20
    `,
    [userId, committeeIds]
  );

  return result.rows.map((r) => ({
    id: r.id,
    committeeId: r.committee_id,
    committeeName: r.committee_name,
    committeeSlug: r.committee_slug,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    maxPoints: r.max_points,
    attachmentUrl: r.attachment_url,
    attachmentName: r.attachment_name,
    createdAt: r.created_at,
    isSubmitted: Boolean(r.submission_id),
    submissionStatus: r.submission_status || 'unsubmitted',
    submissionGrade: r.submission_grade,
    submittedAt: r.submitted_at,
  }));
}

module.exports = {
  createAssignment,
  listAssignmentsByCommittee,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  upsertSubmission,
  listSubmissionsForAssignment,
  gradeSubmission,
  listPendingAssignmentsForUser,
};
