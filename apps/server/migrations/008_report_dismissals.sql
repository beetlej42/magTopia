CREATE TABLE IF NOT EXISTS report_dismissals (
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  report_turn integer NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, player_id, report_turn)
);
