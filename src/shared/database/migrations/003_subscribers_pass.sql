ALTER TABLE target_channels
  ADD COLUMN IF NOT EXISTS subscribers_pass INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_target_channels_subscribers_queue
  ON target_channels (subscribers_pass, participants DESC, id)
  WHERE comments_state = 'open' AND participants >= 1000;
