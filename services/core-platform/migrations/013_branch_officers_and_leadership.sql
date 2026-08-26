-- Migration: 013_branch_officers_and_leadership.sql
-- Description: Branch officers & leadership ("Meet the Brains") schema with season validation

CREATE TABLE IF NOT EXISTS branch_officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  season TEXT NOT NULL,
  is_current_season BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url TEXT,
  linkedin_url TEXT,
  email TEXT,
  bio TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for public season filtering and display order sorting
CREATE INDEX IF NOT EXISTS idx_branch_officers_season_order
  ON branch_officers (season, display_order ASC, is_active);

-- Seed initial branch officers for Season 2025/2026 (Current)
INSERT INTO branch_officers (id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, is_active)
VALUES
  ('b0000001-0000-4000-8000-000000000001', 'Yousef Abdelwahed', 'Branch Chair', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'chair@ieee-menoufia.org', 'Leading branch strategy, member growth, and global IEEE collaboration.', 1, TRUE),
  ('b0000001-0000-4000-8000-000000000002', 'Nour El-Din Ahmed', 'Vice Chair', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'vicechair@ieee-menoufia.org', 'Overseeing internal operations, technical tracks, and project execution.', 2, TRUE),
  ('b0000001-0000-4000-8000-000000000003', 'Mariam Mahmoud', 'Secretary', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'secretary@ieee-menoufia.org', 'Directing branch reporting, communications, and archival records.', 3, TRUE),
  ('b0000001-0000-4000-8000-000000000004', 'Karim Tarek', 'Treasurer', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'treasurer@ieee-menoufia.org', 'Managing financial planning, sponsorship budgets, and resources.', 4, TRUE),
  ('b0000001-0000-4000-8000-000000000005', 'Yousef Bakier', 'Webmaster', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'webmaster@ieee-menoufia.org', 'Head of Web Development & Cloud Computing.', 5, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Seed previous branch officers for Season 2024/2025
INSERT INTO branch_officers (id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, is_active)
VALUES
  ('b0000001-0000-4000-8000-000000000012', 'Mohamed El-Sayed', 'Branch Chair', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'mohamed.prev@ieee-menoufia.org', 'Branch Chair for 2024/2025 academic season.', 1, TRUE),
  ('b0000001-0000-4000-8000-000000000013', 'Dina Samir', 'Vice Chair', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'dina.prev@ieee-menoufia.org', 'Vice Chair for 2024/2025 academic season.', 2, TRUE),
  ('b0000001-0000-4000-8000-000000000014', 'Tariq Nabil', 'Web Development Head', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=400&auto=format&fit=crop&q=80', 'https://linkedin.com', 'tariq.prev@ieee-menoufia.org', 'Web Head for 2024/2025 academic season.', 3, TRUE)
ON CONFLICT (id) DO NOTHING;
