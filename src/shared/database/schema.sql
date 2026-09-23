-- Dumped end state after 001_init. For PR review, not applied at runtime.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Baseline = src/shared/database/schema.ts (+ sessions, media_blobs from live boot).
-- Idempotent: CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS so existing DBs catch up.

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  channel_username TEXT NOT NULL,
  comment_text TEXT,
  post_id INTEGER,
  comment_id INTEGER,
  account_name TEXT NOT NULL,
  target_channel TEXT NOT NULL,
  session_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_channel ON comments(channel_username);
CREATE INDEX IF NOT EXISTS idx_comments_comment_id ON comments(comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique ON comments(channel_username, post_id, account_name);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  target_channel TEXT NOT NULL,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  successful_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  new_channels_count INTEGER DEFAULT 0,
  accounts_used TEXT
);

CREATE TABLE IF NOT EXISTS target_channels (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new',
  parsed BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  processed_at TIMESTAMP,
  parsed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  channel_id BIGINT,
  title TEXT,
  participants INTEGER,
  is_verified BOOLEAN DEFAULT false,
  is_scam BOOLEAN DEFAULT false,
  is_fake BOOLEAN DEFAULT false,
  avg_views INTEGER,
  done_views_pass INTEGER NOT NULL DEFAULT 0,
  avg_reactions INTEGER,
  metrics_at TIMESTAMP,
  comments_state TEXT,
  checked_at TIMESTAMP,
  channel_meta JSONB,
  checked_by TEXT
);
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS parsed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS parsed_at TIMESTAMP;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS channel_id BIGINT;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS participants INTEGER;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS is_scam BOOLEAN DEFAULT false;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS is_fake BOOLEAN DEFAULT false;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS avg_views INTEGER;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS done_views_pass INTEGER NOT NULL DEFAULT 0;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS avg_reactions INTEGER;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS metrics_at TIMESTAMP;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS comments_state TEXT;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS channel_meta JSONB;
ALTER TABLE target_channels ADD COLUMN IF NOT EXISTS checked_by TEXT;
CREATE INDEX IF NOT EXISTS idx_target_channels_status ON target_channels(status);
CREATE INDEX IF NOT EXISTS idx_target_channels_parsed ON target_channels(parsed);
CREATE INDEX IF NOT EXISTS idx_target_channels_participants ON target_channels(participants);
CREATE INDEX IF NOT EXISTS idx_target_channels_comments_state ON target_channels(comments_state);
CREATE INDEX IF NOT EXISTS idx_target_channels_checked_by ON target_channels(checked_by);

CREATE TABLE IF NOT EXISTS account_flood_wait (
  id SERIAL PRIMARY KEY,
  account_name TEXT NOT NULL UNIQUE,
  unlock_at TIMESTAMP NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_flood_wait_unlock ON account_flood_wait(unlock_at);

CREATE TABLE IF NOT EXISTS account_bans (
  id SERIAL PRIMARY KEY,
  account_name TEXT NOT NULL UNIQUE,
  banned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ban_reason TEXT,
  spambot_response TEXT,
  unbanned_at TIMESTAMP,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_bans_active ON account_bans(account_name);

CREATE TABLE IF NOT EXISTS account_group_memberships (
  id SERIAL PRIMARY KEY,
  account_name TEXT NOT NULL,
  group_id BIGINT NOT NULL,
  group_access_hash BIGINT,
  group_username TEXT,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_comment_at TIMESTAMP,
  left_at TIMESTAMP
);
ALTER TABLE account_group_memberships ADD COLUMN IF NOT EXISTS group_access_hash BIGINT;
CREATE INDEX IF NOT EXISTS idx_agm_account_active ON account_group_memberships(account_name, left_at);
CREATE INDEX IF NOT EXISTS idx_agm_account_joined ON account_group_memberships(account_name, joined_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agm_account_group ON account_group_memberships(account_name, group_id);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  session_string TEXT NOT NULL UNIQUE,
  pool TEXT NOT NULL,
  tg_id BIGINT,
  username TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  proxy TEXT,
  source_item_id TEXT,
  notes TEXT,
  meta JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS meta JSONB;
CREATE INDEX IF NOT EXISTS idx_accounts_pool_status ON accounts(pool, status);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  telegram_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_status ON auth_tokens(status);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL,
  channel_username TEXT,
  tg_message_id BIGINT NOT NULL,
  text TEXT,
  media_type TEXT,
  media_refs JSONB,
  entities JSONB,
  views INTEGER,
  reactions JSONB,
  forwards INTEGER,
  replies_count INTEGER,
  posted_at TIMESTAMP,
  collected_at TIMESTAMP DEFAULT NOW(),
  edited_at TIMESTAMP,
  score REAL,
  category TEXT,
  is_political BOOLEAN NOT NULL DEFAULT false,
  is_spam BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS entities JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_channel_msg ON posts(channel_id, tg_message_id);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_posts_channel ON posts(channel_id);
CREATE INDEX IF NOT EXISTS idx_posts_score ON posts(score);

CREATE TABLE IF NOT EXISTS media_blobs (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  views INTEGER,
  reactions INTEGER,
  forwards INTEGER,
  replies_count INTEGER,
  captured_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_metrics_post ON post_metrics(post_id, captured_at);

CREATE TABLE IF NOT EXISTS channel_cursors (
  id SERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL UNIQUE,
  channel_username TEXT,
  last_seen_post_id BIGINT,
  next_poll_at TIMESTAMP,
  tier TEXT NOT NULL DEFAULT 'warm',
  baseline_views INTEGER,
  crawled_at TIMESTAMP,
  avatar_url TEXT,
  joined_at TIMESTAMP,
  excluded BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE channel_cursors ADD COLUMN IF NOT EXISTS crawled_at TIMESTAMP;
ALTER TABLE channel_cursors ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE channel_cursors ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP;
ALTER TABLE channel_cursors ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_channel_cursors_next_poll ON channel_cursors(next_poll_at);

CREATE TABLE IF NOT EXISTS access_hash_cache (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  channel_id BIGINT NOT NULL,
  access_hash BIGINT NOT NULL,
  channel_username TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ahc_account_channel ON access_hash_cache(account_id, channel_id);

CREATE TABLE IF NOT EXISTS feed_jobs (
  id SERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL,
  tg_message_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  claimed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_jobs_channel_msg ON feed_jobs(channel_id, tg_message_id);
CREATE INDEX IF NOT EXISTS idx_feed_jobs_status ON feed_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS video_requests (
  id SERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL,
  tg_message_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  claimed_at TIMESTAMP,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE video_requests ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_requests_channel_msg ON video_requests(channel_id, tg_message_id);
CREATE INDEX IF NOT EXISTS idx_video_requests_status ON video_requests(status, created_at);
