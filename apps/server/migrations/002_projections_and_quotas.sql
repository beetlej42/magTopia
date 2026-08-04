ALTER TABLE asset_jobs ADD COLUMN IF NOT EXISTS requested_by_principal_kind text;
ALTER TABLE asset_jobs ADD COLUMN IF NOT EXISTS requested_by_principal_id text;

CREATE TABLE IF NOT EXISTS city_cells (
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  cell_id text NOT NULL,
  column_index integer NOT NULL,
  row_index integer NOT NULL,
  occupancy_id text,
  infrastructure_kind text,
  reservation_id text,
  data_jsonb jsonb NOT NULL,
  PRIMARY KEY (city_id, cell_id)
);
CREATE INDEX IF NOT EXISTS city_cells_bbox_idx ON city_cells(city_id, column_index, row_index);
CREATE INDEX IF NOT EXISTS city_cells_occupancy_idx ON city_cells(city_id, occupancy_id) WHERE occupancy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS building_projections (
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  building_id text NOT NULL,
  name text NOT NULL,
  archetype text NOT NULL,
  purpose text NOT NULL,
  asset_id text,
  status text NOT NULL,
  data_jsonb jsonb NOT NULL,
  PRIMARY KEY (city_id, building_id)
);
CREATE INDEX IF NOT EXISTS building_projections_search_idx ON building_projections(city_id, archetype, purpose);

CREATE TABLE IF NOT EXISTS building_cells (
  city_id text NOT NULL,
  building_id text NOT NULL,
  cell_id text NOT NULL,
  PRIMARY KEY (city_id, building_id, cell_id),
  FOREIGN KEY (city_id, building_id) REFERENCES building_projections(city_id, building_id) ON DELETE CASCADE
);
