-- ============================================================================
-- Migration: 003_fix_empty_membership_ids.sql
-- Description: Convert empty string membership_ids to NULL to prevent
--              violating the partial unique index idx_users_membership_id
-- ============================================================================

UPDATE public.users
SET membership_id = NULL
WHERE membership_id IS NOT NULL AND TRIM(membership_id) = '';
