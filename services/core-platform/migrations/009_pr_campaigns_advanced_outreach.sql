-- 009_pr_campaigns_advanced_outreach.sql
-- Adds metadata, recipient_user_ids, and custom_recipients to pr_campaigns
-- Adds logs to pr_campaign_dispatch_log

ALTER TABLE pr_campaigns
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recipient_user_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_recipients JSONB DEFAULT '[]'::jsonb;

ALTER TABLE pr_campaign_dispatch_log
  ADD COLUMN IF NOT EXISTS logs JSONB DEFAULT '[]'::jsonb;
