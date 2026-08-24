ALTER TABLE committee_announcements
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE pr_announcements
  ADD COLUMN IF NOT EXISTS image_url TEXT;
