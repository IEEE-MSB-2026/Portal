-- 010_add_archived_pr_campaign_status.sql
-- Adds 'archived' status to pr_campaign_status_type enum

ALTER TYPE pr_campaign_status_type ADD VALUE IF NOT EXISTS 'archived';
