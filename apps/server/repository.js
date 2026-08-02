import { createCityState } from "../../src/city/state.js";
import { getAssetRegistry } from "../../src/city/assets.js";
import { createId, createSecret, hashRequest, hashSecret } from "./ids.js";
import { ServiceError } from "./errors.js";
import { createServiceWorldContract } from "./world.js";

export function createRepository(database, config) {
  return {
    async seedBuiltinAssets() {
      for (const asset of getAssetRegistry()) {
        await database.query(
          `INSERT INTO asset_definitions(id, owner_player_id, archetype, footprint, district_style, tags, status, source, manifest_jsonb)
           VALUES ($1, NULL, $2, $3, $4, $5, 'validated', 'builtin', $6)
           ON CONFLICT (id) DO UPDATE SET manifest_jsonb = EXCLUDED.manifest_jsonb, tags = EXCLUDED.tags, updated_at = now()`,
          [asset.assetId, asset.archetype, asset.footprint, "london_common", asset.tags, JSON.stringify(asset)]
        );
      }
    },

    async createPlayer(displayName) {
      const id = createId("player");
      const token = createSecret("mtp");
      await database.query("INSERT INTO players(id, display_name, auth_token_hash) VALUES ($1, $2, $3)", [id, displayName, hashSecret(token)]);
      return { id, display_name: displayName, access_token: token, token_type: "Bearer" };
    },

    async authenticate(token) {
      if (!token) throw new ServiceError(401, "AUTHENTICATION_REQUIRED", "Bearer token is required");
      const hash = hashSecret(token);
      if (token.startsWith("mtp_")) {
        const result = await database.query("SELECT id, display_name FROM players WHERE auth_token_hash = $1", [hash]);
        if (!result.rowCount) throw new ServiceError(401, "INVALID_CREDENTIAL", "Player credential is invalid");
        return { kind: "player", id: result.rows[0].id, displayName: result.rows[0].display_name, scopes: ["*"] };
      }
      const result = await database.query(
        `UPDATE agent_credentials SET last_used_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
         RETURNING id, city_id, scopes, limits_jsonb`,
        [hash]
      );
      if (!result.rowCount) throw new ServiceError(401, "INVALID_CREDENTIAL", "Agent credential is invalid, expired, or revoked");
      const row = result.rows[0];
      return { kind: "agent", id: row.id, cityId: row.city_id, scopes: row.scopes, limits: row.limits_jsonb };
    },

    async createCity(principal, input = {}) {
      requirePlayer(principal);
      const id = createId("city");
      const mapSeed = input.map_seed ?? "agent-quarter-day-001";
      const world = createServiceWorldContract({
        mapId: input.map_id,
        seed: mapSeed,
        columns: input.world_columns,
        rows: input.world_rows
      });
      const state = createCityState(world, {
        cityId: id,
        mapSeed,
        resources: input.resources,
        rulesetVersion: "magic-london-mvp@1"
      });
      await database.transaction(async (client) => {
        await client.query(
          `INSERT INTO cities(id, owner_player_id, name, visibility, ruleset_version, city_version, state_jsonb)
           VALUES ($1, $2, $3, 'private', $4, $5, $6)`,
          [id, principal.id, input.name ?? "未命名魔法城", state.rulesetVersion, state.version, JSON.stringify(state)]
        );
        await client.query("INSERT INTO city_memberships(city_id, player_id, role) VALUES ($1, $2, 'owner')", [id, principal.id]);
        await writeCityProjections(client, id, state);
      });
      return citySummary({ id, name: input.name ?? "未命名魔法城", visibility: "private", ruleset_version: state.rulesetVersion, city_version: state.version, state_jsonb: state });
    },

    async listCities(principal) {
      requirePlayer(principal);
      const result = await database.query(
        `SELECT c.* FROM cities c JOIN city_memberships m ON m.city_id = c.id
         WHERE m.player_id = $1 ORDER BY c.created_at`,
        [principal.id]
      );
      return result.rows.map(citySummary);
    },

    async getCity(principal, cityId, { write = false } = {}) {
      const row = await database.transaction(async (client) => {
        await assertCityAccess(client, principal, cityId, write);
        const result = await client.query("SELECT * FROM cities WHERE id = $1", [cityId]);
        if (!result.rowCount) throw new ServiceError(404, "CITY_NOT_FOUND", "City not found");
        return result.rows[0];
      });
      return { row, state: row.state_jsonb };
    },

    async getEvents(principal, cityId, afterVersion = 0, limit = 100) {
      await this.getCity(principal, cityId);
      const result = await database.query(
        `SELECT id, city_version, event_type, payload_jsonb, created_at FROM city_events
         WHERE city_id = $1 AND city_version > $2 ORDER BY city_version, created_at LIMIT $3`,
        [cityId, afterVersion, Math.min(200, limit)]
      );
      return result.rows.map((row) => ({ id: row.id, city_version: Number(row.city_version), type: row.event_type, at: row.created_at, ...row.payload_jsonb }));
    },

    async createCapability(principal, cityId, options = {}) {
      requirePlayer(principal);
      await this.getCity(principal, cityId, { write: true });
      const id = createId("cap");
      const secret = createSecret("mtc");
      const scopes = normalizeScopes(options.scopes);
      const expiresAt = new Date(Date.now() + config.capabilityTtlMinutes * 60_000);
      await database.query(
        `INSERT INTO agent_capabilities(id, city_id, token_hash, scopes, expires_at, created_by_player_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, cityId, hashSecret(secret), scopes, expiresAt, principal.id]
      );
      return { id, city_id: cityId, connect_url: `${config.publicBaseUrl}/connect/${secret}`, scopes, expires_at: expiresAt.toISOString() };
    },

    async exchangeCapability(secret) {
      return database.transaction(async (client) => {
        const found = await client.query(
          `SELECT * FROM agent_capabilities WHERE token_hash = $1 FOR UPDATE`,
          [hashSecret(secret)]
        );
        if (!found.rowCount) throw new ServiceError(404, "CAPABILITY_NOT_FOUND", "Agent connection link is invalid");
        const cap = found.rows[0];
        if (cap.revoked_at) throw new ServiceError(410, "CAPABILITY_REVOKED", "Agent connection link was revoked");
        if (cap.consumed_at) throw new ServiceError(410, "CAPABILITY_CONSUMED", "Agent connection link was already used");
        if (new Date(cap.expires_at) <= new Date()) throw new ServiceError(410, "CAPABILITY_EXPIRED", "Agent connection link expired");
        const credentialId = createId("credential");
        const token = createSecret("mta");
        const expiresAt = new Date(Date.now() + config.credentialTtlDays * 86_400_000);
        await client.query(
          `INSERT INTO agent_credentials(id, city_id, token_hash, scopes, limits_jsonb, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [credentialId, cap.city_id, hashSecret(token), cap.scopes, JSON.stringify({ asset_jobs_per_day: 3 }), expiresAt]
        );
        await client.query("UPDATE agent_capabilities SET consumed_at = now() WHERE id = $1", [cap.id]);
        return {
          credential_id: credentialId,
          city_id: cap.city_id,
          access_token: token,
          token_type: "Bearer",
          scopes: cap.scopes,
          expires_at: expiresAt.toISOString(),
          api_base_url: `${config.publicBaseUrl}/api/v1`,
          playbook_url: `${config.publicBaseUrl}/agent/playbook.md`,
          openapi_url: `${config.publicBaseUrl}/openapi.json`
        };
      });
    },

    async listCredentials(principal, cityId) {
      requirePlayer(principal);
      await this.getCity(principal, cityId, { write: true });
      const result = await database.query(
        `SELECT id, scopes, limits_jsonb, expires_at, revoked_at, last_used_at, created_at
         FROM agent_credentials WHERE city_id = $1 ORDER BY created_at DESC`,
        [cityId]
      );
      return result.rows;
    },

    async revokeCredential(principal, cityId, credentialId) {
      requirePlayer(principal);
      await this.getCity(principal, cityId, { write: true });
      const result = await database.query("UPDATE agent_credentials SET revoked_at = now() WHERE id = $1 AND city_id = $2 RETURNING id", [credentialId, cityId]);
      if (!result.rowCount) throw new ServiceError(404, "CREDENTIAL_NOT_FOUND", "Agent credential not found");
      return { id: credentialId, revoked: true };
    },

    async searchAssets(principal, criteria = {}) {
      const ownerId = principal.kind === "player" ? principal.id : await ownerForCity(database, principal.cityId);
      const values = [ownerId];
      const clauses = ["status = 'validated'", "(owner_player_id IS NULL OR owner_player_id = $1)"];
      for (const [column, value] of [["archetype", criteria.archetype], ["footprint", criteria.footprint], ["district_style", criteria.district_style]]) {
        if (!value) continue;
        values.push(value);
        clauses.push(`${column} = $${values.length}`);
      }
      values.push(Math.min(Number(criteria.limit ?? 20), 50));
      const result = await database.query(
        `SELECT * FROM asset_definitions WHERE ${clauses.join(" AND ")} ORDER BY owner_player_id NULLS FIRST, created_at LIMIT $${values.length}`,
        values
      );
      return result.rows.map((row) => assetResponse(row, criteria));
    },

    async getAsset(principal, assetId) {
      const ownerId = principal.kind === "player" ? principal.id : await ownerForCity(database, principal.cityId);
      const result = await database.query(
        "SELECT * FROM asset_definitions WHERE id = $1 AND status = 'validated' AND (owner_player_id IS NULL OR owner_player_id = $2)",
        [assetId, ownerId]
      );
      return result.rowCount ? assetResponse(result.rows[0], {}) : null;
    },

    async getAssetsForCity(principal, cityId, assetIds = []) {
      const { row } = await this.getCity(principal, cityId);
      const uniqueIds = [...new Set(assetIds.filter(Boolean))];
      if (!uniqueIds.length) return [];
      const result = await database.query(
        `SELECT * FROM asset_definitions
         WHERE id = ANY($1::text[]) AND status = 'validated'
         AND (owner_player_id IS NULL OR owner_player_id = $2)
         ORDER BY owner_player_id NULLS FIRST, created_at`,
        [uniqueIds, row.owner_player_id]
      );
      return result.rows.map((asset) => assetResponse(asset, {}));
    },

    async createBuildingDesign(principal, cityId, design) {
      return database.transaction(async (client) => {
        await assertCityAccess(client, principal, cityId, true);
        await client.query(
          `INSERT INTO building_designs(
             id, city_id, building_id, status, generation_mode, current_revision,
             confirmed_revision, created_by_principal_kind, created_by_principal_id
           ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
          [
            design.id,
            cityId,
            design.source?.buildingId ?? null,
            design.status,
            design.generation.mode,
            design.revision,
            principal.kind,
            principal.id
          ]
        );
        await insertBuildingDesignRevision(client, principal, design);
        return buildingDesignResponse({
          id: design.id,
          city_id: cityId,
          building_id: design.source?.buildingId ?? null,
          status: design.status,
          current_revision: design.revision,
          confirmed_revision: null,
          design_jsonb: design,
          created_at: new Date(),
          updated_at: new Date()
        });
      });
    },

    async getBuildingDesign(principal, cityId, designId) {
      await this.getCity(principal, cityId);
      const result = await database.query(
        `SELECT d.*, r.design_jsonb, r.spec_hash
         FROM building_designs d
         JOIN building_design_revisions r ON r.design_id = d.id AND r.revision = d.current_revision
         WHERE d.id = $1 AND d.city_id = $2`,
        [designId, cityId]
      );
      if (!result.rowCount) throw new ServiceError(404, "BUILDING_DESIGN_NOT_FOUND", "Building design not found");
      return buildingDesignResponse(result.rows[0]);
    },

    async listBuildingDesigns(principal, cityId) {
      await this.getCity(principal, cityId);
      const result = await database.query(
        `SELECT d.*, r.design_jsonb, r.spec_hash
         FROM building_designs d
         JOIN building_design_revisions r ON r.design_id = d.id AND r.revision = d.current_revision
         WHERE d.city_id = $1 ORDER BY d.updated_at DESC LIMIT 100`,
        [cityId]
      );
      return result.rows.map(buildingDesignResponse);
    },

    async appendBuildingDesignRevision(principal, cityId, design, expectedRevision) {
      return database.transaction(async (client) => {
        await assertCityAccess(client, principal, cityId, true);
        const found = await client.query("SELECT * FROM building_designs WHERE id = $1 AND city_id = $2 FOR UPDATE", [design.id, cityId]);
        if (!found.rowCount) throw new ServiceError(404, "BUILDING_DESIGN_NOT_FOUND", "Building design not found");
        const row = found.rows[0];
        if (row.status !== "editable") throw new ServiceError(409, "BUILDING_DESIGN_LOCKED", `Building design is ${row.status}`);
        if (Number(row.current_revision) !== Number(expectedRevision)) {
          throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", "Building design changed since it was read", { expected: Number(expectedRevision), actual: Number(row.current_revision) });
        }
        if (design.revision !== Number(row.current_revision) + 1) throw new ServiceError(400, "INVALID_BUILDING_DESIGN_REVISION", "New building design revision must increment by one");
        await insertBuildingDesignRevision(client, principal, design);
        await client.query(
          "UPDATE building_designs SET current_revision = $1, generation_mode = $2, updated_at = now() WHERE id = $3",
          [design.revision, design.generation.mode, design.id]
        );
        return buildingDesignResponse({ ...row, current_revision: design.revision, generation_mode: design.generation.mode, design_jsonb: design, spec_hash: design.specHash, updated_at: new Date() });
      });
    },

    async confirmBuildingDesign(principal, cityId, design, expectedRevision) {
      return database.transaction(async (client) => {
        await assertCityAccess(client, principal, cityId, true);
        const found = await client.query("SELECT * FROM building_designs WHERE id = $1 AND city_id = $2 FOR UPDATE", [design.id, cityId]);
        if (!found.rowCount) throw new ServiceError(404, "BUILDING_DESIGN_NOT_FOUND", "Building design not found");
        const row = found.rows[0];
        if (Number(row.current_revision) !== Number(expectedRevision)) {
          throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", "Building design changed since it was read", { expected: Number(expectedRevision), actual: Number(row.current_revision) });
        }
        if (row.status === "built") throw new ServiceError(409, "BUILDING_DESIGN_ALREADY_BUILT", "Building design was already built");
        await client.query(
          "UPDATE building_designs SET status = 'confirmed', confirmed_revision = current_revision, updated_at = now() WHERE id = $1",
          [design.id]
        );
        return buildingDesignResponse({ ...row, status: "confirmed", confirmed_revision: expectedRevision, design_jsonb: design, spec_hash: design.specHash, updated_at: new Date() });
      });
    },

    async getOrder(principal, cityId, orderId) {
      await this.getCity(principal, cityId);
      const result = await database.query("SELECT * FROM construction_orders WHERE id = $1 AND city_id = $2", [orderId, cityId]);
      if (!result.rowCount) throw new ServiceError(404, "ORDER_NOT_FOUND", "Construction order not found");
      return orderResponse(result.rows[0]);
    },

    async listOrders(principal, cityId) {
      await this.getCity(principal, cityId);
      const result = await database.query("SELECT * FROM construction_orders WHERE city_id = $1 ORDER BY created_at DESC LIMIT 100", [cityId]);
      return result.rows.map(orderResponse);
    },

    async getAssetJob(principal, jobId) {
      const result = await database.query("SELECT * FROM asset_jobs WHERE id = $1", [jobId]);
      if (!result.rowCount) throw new ServiceError(404, "ASSET_JOB_NOT_FOUND", "Asset job not found");
      await this.getCity(principal, result.rows[0].city_id);
      return assetJobResponse(result.rows[0]);
    },

    async transactCity({ principal, cityId, endpoint, idempotencyKey, requestBody, expectedVersion, action, reason }, handler) {
      if (!idempotencyKey) throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
      const requestHash = hashRequest(requestBody);
      return database.transaction(async (client) => {
        await assertCityAccess(client, principal, cityId, true);
        const prior = await client.query(
          `SELECT request_hash, response_jsonb FROM command_receipts
           WHERE principal_kind = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
          [principal.kind, principal.id, endpoint, idempotencyKey]
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== requestHash) throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different request");
          return { ...prior.rows[0].response_jsonb, idempotent_replay: true };
        }
        const cityResult = await client.query("SELECT * FROM cities WHERE id = $1 FOR UPDATE", [cityId]);
        if (!cityResult.rowCount) throw new ServiceError(404, "CITY_NOT_FOUND", "City not found");
        const city = cityResult.rows[0];
        const actualVersion = Number(city.city_version);
        if (expectedVersion !== undefined && Number(expectedVersion) !== actualVersion) {
          throw new ServiceError(409, "CITY_VERSION_CONFLICT", "City changed since the preview", { expected: Number(expectedVersion), actual: actualVersion });
        }
        const state = city.state_jsonb;
        const eventCount = state.events?.length ?? 0;
        const handled = await handler({ client, state, city });
        const response = handled.response;
        if (handled.nextState) {
          await client.query(
            "UPDATE cities SET state_jsonb = $1, city_version = $2, updated_at = now() WHERE id = $3",
            [JSON.stringify(handled.nextState), handled.nextState.version, cityId]
          );
          await writeCityProjections(client, cityId, handled.nextState);
          const events = handled.nextState.events.slice(eventCount);
          for (const event of events) {
            await client.query(
              `INSERT INTO city_events(id, city_id, city_version, event_type, payload_jsonb, created_at)
               VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
              [event.id, cityId, event.cityVersion ?? handled.nextState.version, event.type, JSON.stringify(event), event.at]
            );
          }
        }
        await client.query(
          `INSERT INTO command_receipts(id, principal_kind, principal_id, endpoint, idempotency_key, request_hash, response_jsonb)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [createId("receipt"), principal.kind, principal.id, endpoint, idempotencyKey, requestHash, JSON.stringify(response)]
        );
        await client.query(
          `INSERT INTO agent_action_log(id, city_id, principal_kind, principal_id, action, reason, result, command_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [createId("action"), cityId, principal.kind, principal.id, action, reason ?? null, response.status ?? "completed", response.command_id ?? null]
        );
        return response;
      });
    },

    database
  };
}

async function assertCityAccess(client, principal, cityId, write) {
  if (principal.kind === "agent") {
    if (principal.cityId !== cityId) throw new ServiceError(403, "CITY_ACCESS_DENIED", "Credential is scoped to another city");
    return;
  }
  const result = await client.query("SELECT role FROM city_memberships WHERE city_id = $1 AND player_id = $2", [cityId, principal.id]);
  if (!result.rowCount) throw new ServiceError(404, "CITY_NOT_FOUND", "City not found");
  if (write && result.rows[0].role === "viewer") throw new ServiceError(403, "CITY_WRITE_DENIED", "City membership is read-only");
}

function requirePlayer(principal) {
  if (principal?.kind !== "player") throw new ServiceError(403, "PLAYER_CREDENTIAL_REQUIRED", "This action requires a player credential");
}

function normalizeScopes(scopes) {
  const allowed = new Set(["city:read", "city:build", "city:connect", "asset:request"]);
  const normalized = scopes?.length ? scopes : [...allowed];
  for (const scope of normalized) if (!allowed.has(scope)) throw new ServiceError(400, "INVALID_SCOPE", `Unsupported Agent scope: ${scope}`);
  return [...new Set(normalized)];
}

function citySummary(row) {
  const state = row.state_jsonb;
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ruleset_version: row.ruleset_version,
    city_version: Number(row.city_version),
    turn: state.turn,
    resources: state.resources,
    counts: { buildings: Object.keys(state.buildings ?? {}).length, roads: Object.values(state.cells ?? {}).filter((cell) => cell.infrastructure === "road").length, pending_orders: Object.keys(state.reservations ?? {}).length }
  };
}

function assetResponse(row, criteria = {}) {
  const requested = [["archetype", criteria.archetype], ["footprint", criteria.footprint], ["district_style", criteria.district_style]].filter(([, value]) => value);
  const differences = requested.filter(([key, value]) => row[key] !== value).map(([key, value]) => ({ field: key, requested: value, actual: row[key] }));
  const exact = requested.length - differences.length;
  return {
    id: row.id,
    owner_player_id: row.owner_player_id,
    archetype: row.archetype,
    footprint: row.footprint,
    district_style: row.district_style,
    tags: row.tags,
    status: row.status,
    source: row.source,
    manifest: row.manifest_jsonb,
    match: { score: requested.length ? exact / requested.length : 1, exact: differences.length === 0, differences, recommendation: differences.length ? "produce_or_broaden_search" : "reuse" }
  };
}

function orderResponse(row) {
  return { id: row.id, city_id: row.city_id, status: row.status, reservation_id: row.reservation_id, asset: { mode: row.asset_mode, asset_id: row.asset_id, job_id: row.asset_job_id }, request: row.request_jsonb, error: row.error_jsonb, created_at: row.created_at, updated_at: row.updated_at };
}

function assetJobResponse(row) {
  return { id: row.id, city_id: row.city_id, status: row.status, provider: row.provider, spec: row.spec_jsonb, attempts: row.attempts, output: row.output_jsonb, error: row.error_jsonb, created_at: row.created_at, updated_at: row.updated_at };
}

function buildingDesignResponse(row) {
  return {
    ...structuredClone(row.design_jsonb),
    id: row.id,
    cityId: row.city_id,
    buildingId: row.building_id ?? row.design_jsonb?.source?.buildingId ?? null,
    status: row.status,
    revision: Number(row.current_revision),
    confirmedRevision: row.confirmed_revision == null ? null : Number(row.confirmed_revision),
    specHash: row.spec_hash ?? row.design_jsonb?.specHash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function insertBuildingDesignRevision(client, principal, design) {
  await client.query(
    `INSERT INTO building_design_revisions(
       design_id, revision, spec_hash, design_jsonb, created_by_principal_kind, created_by_principal_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [design.id, design.revision, design.specHash, JSON.stringify(design), principal.kind, principal.id]
  );
}

async function ownerForCity(database, cityId) {
  const result = await database.query("SELECT owner_player_id FROM cities WHERE id = $1", [cityId]);
  if (!result.rowCount) throw new ServiceError(404, "CITY_NOT_FOUND", "City not found");
  return result.rows[0].owner_player_id;
}

async function writeCityProjections(client, cityId, state) {
  await client.query("DELETE FROM city_cells WHERE city_id = $1", [cityId]);
  await client.query(
    `INSERT INTO city_cells(city_id, cell_id, column_index, row_index, occupancy_id, infrastructure_kind, reservation_id, data_jsonb)
     SELECT $1, key, (value->>'column')::integer, (value->>'row')::integer, value->>'occupancy', value->>'infrastructure', value->>'reservation', value
     FROM jsonb_each($2::jsonb)`,
    [cityId, JSON.stringify(state.cells)]
  );
  await client.query("DELETE FROM building_projections WHERE city_id = $1", [cityId]);
  for (const building of Object.values(state.buildings ?? {})) {
    await client.query(
      `INSERT INTO building_projections(city_id, building_id, name, archetype, purpose, asset_id, status, data_jsonb)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [cityId, building.id, building.program?.name ?? building.id, building.program?.archetype ?? "unknown", building.program?.purpose ?? "mixed_use", building.assetId ?? building.program?.assetId ?? null, building.status ?? "completed", JSON.stringify(building)]
    );
    for (const cellId of building.footprintCells ?? []) await client.query("INSERT INTO building_cells(city_id, building_id, cell_id) VALUES ($1, $2, $3)", [cityId, building.id, cellId]);
  }
}
