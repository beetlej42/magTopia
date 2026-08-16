CREATE TABLE IF NOT EXISTS owl_reports (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  turn integer NOT NULL,
  facts_digest text NOT NULL,
  edition text NOT NULL,
  request_hash text NOT NULL,
  report_jsonb jsonb NOT NULL,
  created_by_principal_kind text NOT NULL,
  created_by_principal_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, turn)
);
CREATE INDEX IF NOT EXISTS owl_reports_city_turn_idx ON owl_reports(city_id, turn DESC);
