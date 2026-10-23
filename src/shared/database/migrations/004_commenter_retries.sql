CREATE TABLE IF NOT EXISTS commenter_retries (
  sender TEXT NOT NULL,
  channel_username TEXT NOT NULL,
  retry_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  PRIMARY KEY (sender, channel_username)
);
