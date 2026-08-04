CREATE TABLE IF NOT EXISTS building_designs (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  building_id text,
  status text NOT NULL CHECK (status IN ('editable', 'confirmed', 'built', 'cancelled')),
  generation_mode text NOT NULL CHECK (generation_mode IN ('floor_stack', 'urban_massing')),
  current_revision integer NOT NULL,
  confirmed_revision integer,
  created_by_principal_kind text NOT NULL,
  created_by_principal_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_designs_city_idx ON building_designs(city_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS building_designs_building_idx ON building_designs(city_id, building_id) WHERE building_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS building_design_revisions (
  design_id text NOT NULL REFERENCES building_designs(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  spec_hash text NOT NULL,
  design_jsonb jsonb NOT NULL,
  created_by_principal_kind text NOT NULL,
  created_by_principal_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (design_id, revision)
);

ALTER TABLE construction_orders DROP CONSTRAINT IF EXISTS construction_orders_asset_mode_check;
ALTER TABLE construction_orders ADD CONSTRAINT construction_orders_asset_mode_check CHECK (asset_mode IN ('reuse', 'produce', 'voxel'));
