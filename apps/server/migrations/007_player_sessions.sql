CREATE TABLE IF NOT EXISTS player_sessions (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_sessions_player_idx ON player_sessions(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS player_sessions_active_idx ON player_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;
