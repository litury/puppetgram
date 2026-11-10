ALTER TABLE target_channels
  ADD COLUMN IF NOT EXISTS last_repeat_visit_at TIMESTAMP;
