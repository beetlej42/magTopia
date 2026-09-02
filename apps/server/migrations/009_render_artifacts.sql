CREATE TABLE IF NOT EXISTS render_artifacts (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  building_id text,
  design_id text,
  design_revision integer NOT NULL,
  source_hash text NOT NULL,
  format_version integer NOT NULL,
  sha256 text,
  byte_length bigint,
  relative_path text,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'waiting_for_building', 'ready', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, design_id, design_revision, source_hash)
);
CREATE INDEX IF NOT EXISTS render_artifacts_city_ready_idx
  ON render_artifacts(city_id, status, building_id, design_revision);
CREATE INDEX IF NOT EXISTS render_artifacts_building_idx
  ON render_artifacts(city_id, building_id, design_revision DESC);
