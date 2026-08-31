-- Migration: 008_add_hr_role_in_committee.sql
-- Description: Add 'hr' role to role_in_committee_type enum for HR follow-up read-only observers.

ALTER TYPE role_in_committee_type ADD VALUE IF NOT EXISTS 'hr';
