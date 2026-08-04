CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  auth_token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cities (
  id text PRIMARY KEY,
  owner_player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  ruleset_version text NOT NULL,
  city_version bigint NOT NULL DEFAULT 0,
  state_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS city_memberships (
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, player_id)
);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by_player_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  limits_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS city_events (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  city_version bigint NOT NULL,
  event_type text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS city_events_city_version_idx ON city_events(city_id, city_version, created_at);

CREATE TABLE IF NOT EXISTS command_receipts (
  id text PRIMARY KEY,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_kind, principal_id, endpoint, idempotency_key)
);

CREATE TABLE IF NOT EXISTS asset_definitions (
  id text PRIMARY KEY,
  owner_player_id text REFERENCES players(id) ON DELETE CASCADE,
  archetype text NOT NULL,
  footprint text NOT NULL,
  district_style text,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('validating', 'validated', 'rejected')),
  source text NOT NULL,
  manifest_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_definitions_search_idx ON asset_definitions(archetype, footprint, status);

CREATE TABLE IF NOT EXISTS asset_jobs (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  owner_player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status text NOT NULL,
  provider text NOT NULL,
  spec_jsonb jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  output_jsonb jsonb,
  error_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS construction_orders (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  status text NOT NULL,
  reservation_id text,
  asset_mode text NOT NULL CHECK (asset_mode IN ('reuse', 'produce')),
  asset_id text,
  asset_job_id text REFERENCES asset_jobs(id),
  request_jsonb jsonb NOT NULL,
  error_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS construction_orders_city_idx ON construction_orders(city_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_jobs (
  id text PRIMARY KEY,
  job_type text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_jobs(status, available_at);

CREATE TABLE IF NOT EXISTS agent_action_log (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  action text NOT NULL,
  reason text,
  result text NOT NULL,
  command_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
