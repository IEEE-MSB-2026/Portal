-- Migration 014: Make media_albums.committee_id optional for branch-wide / general albums
ALTER TABLE media_albums ALTER COLUMN committee_id DROP NOT NULL;
