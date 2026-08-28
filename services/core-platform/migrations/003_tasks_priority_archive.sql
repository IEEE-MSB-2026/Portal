-- Migration: 003_tasks_priority_archive.sql
-- Description: Add priority and is_archived columns to tasks table and ensure resource_type index.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks (is_archived);
