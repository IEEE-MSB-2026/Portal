-- Migration 006: Allow tasks to be unassigned (nullable assignee_user_id)
ALTER TABLE tasks ALTER COLUMN assignee_user_id DROP NOT NULL;
