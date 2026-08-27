-- Migration: 016_add_membership_id_to_users.sql
-- Description: Add membership_id column and unique index to auth_users and users_ref

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS membership_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_membership_id 
  ON auth_users (membership_id) 
  WHERE membership_id IS NOT NULL;

ALTER TABLE users_ref ADD COLUMN IF NOT EXISTS membership_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_membership_id 
  ON users_ref (membership_id) 
  WHERE membership_id IS NOT NULL;
