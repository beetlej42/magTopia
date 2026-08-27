import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCityState } from "../../src/city/state.js";
import { getAssetRegistry } from "../../src/city/assets.js";
import { createServiceWorldContract } from "./world.js";
import { ACTIVE_TURN_STATUSES, SETTLED_TURN_STATUSES, initializeFreshCitySchedule } from "../../src/gameplay/turn.js";
import { createId, createSecret, hashRequest } from "./ids.js";
import { ServiceError } from "./errors.js";

// A lightweight repository for black-box API acceptance and LAN demos. With a
// storagePath it atomically snapshots every mutation and survives restarts;
// without one it remains an isolated process-local repository for tests.
export function createMemoryRepository(config, options = {}) {
  const storagePath = options.storagePath ? path.resolve(options.storagePath) : null;
  const now = options.now ?? (() => new Date());
  const players = new Map();
  const credentials = new Map();
  const capabilities = new Map();
  const cities = new Map();
  const designs = new Map();
  const orders = new Map();
  const receipts = new Map();
  const owlReports = new Map();
  const reportDismissals = new Map();
  const assets = new Map(getAssetRegistry().map((asset) => [asset.assetId, asset]));
  hydratePersistentState(storagePath, { players, credentials, capabilities, cities, designs, orders, receipts, owlReports, reportDismissals });

  const persist = () => persistState(storagePath, { players, credentials, capabilities, cities, designs, orders, receipts, owlReports, reportDismissals });

  const repository = {
    async createPlayer(displayName) {
      const id = createId("player");
      const token = createSecret("mtp");
      players.set(token, { id, displayName });
      persist();
      return { id, display_name: displayName, access_token: token, token_type: "Bearer" };
    },

    async authenticate(token) {
      if (!token) throw new ServiceError(401, "AUTHENTICATION_REQUIRED", "Bearer token is required");
      const player = players.get(token);
      if (player) return { kind: "player", id: player.id, displayName: player.displayName, scopes: ["*"] };
      const credential = credentials.get(token);
      if (!credential || credential.revoked) throw new ServiceError(401, "INVALID_CREDENTIAL", "Credential is invalid or revoked");
      return { kind: "agent", id: credential.id, cityId: credential.cityId, scopes: credential.scopes, limits: credential.limits };
    },

    async createCity(principal, input = {}) {
      requirePlayer(principal);
      const id = createId("city");
      const mapSeed = input.map_seed ?? "external-agent-acceptance";
      const world = createServiceWorldContract({
        mapId: input.map_id,
        seed: mapSeed,
        columns: input.world_columns,
        rows: input.world_rows
      });
      const state = initializeFreshCitySchedule(createCityState(world, {
        cityId: id,
        mapSeed,
        resources: input.resources,
        rulesetVersion: "magic-london-mvp@1"
      }), now().toISOString(), config);
      const row = {
        id,
        owner_player_id: principal.id,
        name: input.name ?? "External Agent Acceptance City",
        visibility: "private",
        ruleset_version: state.rulesetVersion,
        city_version: state.version,
        state_jsonb: state
      };
      cities.set(id, row);
      persist();
      return citySummary(row);
    },

    async listCities(principal) {
      requirePlayer(principal);
      return [...cities.values()].filter((row) => row.owner_player_id === principal.id).map(citySummary);
    },

    async getCity(principal, cityId) {
      const row = cities.get(cityId);
      if (!row || !canAccess(principal, row)) throw new ServiceError(404, "CITY_NOT_FOUND", "City not found");
      return { row, state: row.state_jsonb };
    },

    async getEvents(principal, cityId, afterVersion = 0, limit = 100) {
      const { state } = await this.getCity(principal, cityId);
      return (state.events ?? []).filter((event) => Number(event.cityVersion ?? 0) > afterVersion).slice(0, Math.min(200, limit));
    },

    async createCapability(principal, cityId, options = {}) {
      requirePlayer(principal);
      await this.getCity(principal, cityId);
      const secret = createSecret("mtc");
      const scopes = options.scopes?.length ? [...new Set(options.scopes)] : ["city:read", "city:build", "city:connect", "asset:request"];
      const id = createId("cap");
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      capabilities.set(secret, { id, cityId, scopes, expiresAt, consumed: false });
      persist();
      return { id, city_id: cityId, connect_url: `${config.publicBaseUrl}/connect/${secret}`, scopes, expires_at: expiresAt.toISOString() };
    },

    async exchangeCapability(secret) {
      const capability = capabilities.get(secret);
      if (!capability) throw new ServiceError(404, "CAPABILITY_NOT_FOUND", "Agent connection link is invalid");
      if (capability.consumed) throw new ServiceError(410, "CAPABILITY_CONSUMED", "Agent connection link was already used");
      if (capability.expiresAt <= new Date()) throw new ServiceError(410, "CAPABILITY_EXPIRED", "Agent connection link expired");
      capability.consumed = true;
      const token = createSecret("mta");
      const id = createId("credential");
      credentials.set(token, { id, cityId: capability.cityId, scopes: capability.scopes, limits: { asset_jobs_per_day: 3 }, revoked: false });
      persist();
      return {
        credential_id: id,
        city_id: capability.cityId,
        access_token: token,
        token_type: "Bearer",
        scopes: capability.scopes,
        expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        api_base_url: `${config.publicBaseUrl}/api/v1`,
        playbook_url: `${config.publicBaseUrl}/agent/playbook.md`,
        openapi_url: `${config.publicBaseUrl}/openapi.json`
      };
    },

    async listCredentials(principal, cityId) {
      requirePlayer(principal);
      await this.getCity(principal, cityId);
      return [...credentials.values()].filter((item) => item.cityId === cityId).map((item) => ({ id: item.id, scopes: item.scopes, revoked_at: item.revoked ? new Date().toISOString() : null }));
    },

    async revokeCredential(principal, cityId, credentialId) {
      requirePlayer(principal);
      await this.getCity(principal, cityId);
      const found = [...credentials.values()].find((item) => item.id === credentialId && item.cityId === cityId);
      if (!found) throw new ServiceError(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
      found.revoked = true;
      persist();
      return { id: credentialId, revoked: true };
    },

    async searchAssets(_principal, criteria = {}) {
      return [...assets.values()].filter((asset) => (!criteria.archetype || asset.archetype === criteria.archetype) && (!criteria.footprint || asset.footprint === criteria.footprint)).slice(0, Number(criteria.limit ?? 20)).map(assetResponse);
    },
    async getAsset(_principal, assetId) { return assets.has(assetId) ? assetResponse(assets.get(assetId)) : null; },
    async getAssetsForCity(principal, cityId, assetIds = []) { await this.getCity(principal, cityId); return assetIds.filter((id) => assets.has(id)).map((id) => assetResponse(assets.get(id))); },

    async createBuildingDesign(principal, cityId, design) {
      await this.getCity(principal, cityId);
      const now = new Date().toISOString();
      const value = { ...structuredClone(design), cityId, buildingId: design.source?.buildingId ?? null, status: design.status, confirmedRevision: null, createdAt: now, updatedAt: now };
      designs.set(design.id, value);
      persist();
      return structuredClone(value);
    },
    async getBuildingDesign(principal, cityId, designId) {
      await this.getCity(principal, cityId);
      const design = designs.get(designId);
      if (!design || design.cityId !== cityId) throw new ServiceError(404, "BUILDING_DESIGN_NOT_FOUND", "Building design not found");
      return structuredClone(design);
    },
    async listBuildingDesigns(principal, cityId) { await this.getCity(principal, cityId); return [...designs.values()].filter((design) => design.cityId === cityId).map((design) => structuredClone(design)); },
    async appendBuildingDesignRevision(principal, cityId, design, expectedRevision) {
      const current = await this.getBuildingDesign(principal, cityId, design.id);
      if (current.status !== "editable") throw new ServiceError(409, "BUILDING_DESIGN_LOCKED", `Building design is ${current.status}`);
      if (Number(current.revision) !== Number(expectedRevision)) throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", "Building design changed since it was read");
      const value = { ...structuredClone(design), cityId, buildingId: current.buildingId, status: "editable", confirmedRevision: null, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
      designs.set(design.id, value);
      persist();
      return structuredClone(value);
    },
    async confirmBuildingDesign(principal, cityId, design, expectedRevision) {
      const current = await this.getBuildingDesign(principal, cityId, design.id);
      if (Number(current.revision) !== Number(expectedRevision)) throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", "Building design changed since it was read");
      const value = { ...structuredClone(design), cityId, buildingId: current.buildingId, status: "confirmed", confirmedRevision: design.revision, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
      designs.set(design.id, value);
      persist();
      return structuredClone(value);
    },

    async getOrder(principal, cityId, orderId) { await this.getCity(principal, cityId); const order = orders.get(orderId); if (!order || order.city_id !== cityId) throw new ServiceError(404, "ORDER_NOT_FOUND", "Order not found"); return structuredClone(order); },
    async listOrders(principal, cityId) { await this.getCity(principal, cityId); return [...orders.values()].filter((order) => order.city_id === cityId).map((order) => structuredClone(order)); },

    async getCityForScheduler(cityId) {
      const row = cities.get(cityId);
      return row ? { row, state: row.state_jsonb } : null;
    },

    async scanCitiesForScheduler(nowIso) {
      // Only active turns missing a schedule (lazy init) and settled turns whose
      // unlock slot elapsed (open the next turn) are due. Active overdue turns
      // are never due: there is no deadline auto-settle.
      const due = [];
      for (const row of cities.values()) {
        const gameplay = row.state_jsonb.gameplay ?? {};
        const active = ACTIVE_TURN_STATUSES.has(gameplay.turnStatus);
        const settled = SETTLED_TURN_STATUSES.has(gameplay.turnStatus);
        if (active && gameplay.nextTurnUnlockAt == null) due.push(row);
        else if (settled && gameplay.nextTurnUnlockAt != null && gameplay.nextTurnUnlockAt <= nowIso) due.push(row);
      }
      return due;
    },

    async schedulerTransact({ cityId, endpoint, idempotencyKey, requestBody = {}, expectedVersion, action, reason }, handler) {
      if (!idempotencyKey) throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for scheduler transactions");
      const receiptKey = `system:turn-scheduler:${endpoint}:${idempotencyKey}`;
      const requestHash = hashRequest({ ...requestBody, cityId, endpoint });
      const prior = receipts.get(receiptKey);
      if (prior) {
        if (prior.hash !== requestHash) throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "Scheduler idempotency key was already used with different work");
        return { ...structuredClone(prior.response), idempotent_replay: true };
      }
      const row = cities.get(cityId);
      if (!row) throw new ServiceError(404, "CITY_NOT_FOUND", "City not found");
      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(row.state_jsonb.version)) {
        throw new ServiceError(409, "CITY_VERSION_CONFLICT", "City changed since the scheduler read it", { expected: Number(expectedVersion), actual: Number(row.state_jsonb.version) });
      }
      const client = memoryClient({ cityId, row, designs, orders, assets });
      const handled = await handler({ client, state: row.state_jsonb, city: row });
      if (handled.nextState) {
        row.state_jsonb = handled.nextState;
        row.city_version = handled.nextState.version;
      }
      receipts.set(receiptKey, { hash: requestHash, response: structuredClone(handled.response) });
      persist();
      return handled.response;
    },

    async transactCity({ principal, cityId, endpoint, idempotencyKey, requestBody, expectedVersion }, handler) {
      if (!idempotencyKey) throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
      const receiptKey = `${principal.kind}:${principal.id}:${endpoint}:${idempotencyKey}`;
      const requestHash = hashRequest(requestBody);
      const prior = receipts.get(receiptKey);
      if (prior) {
        if (prior.hash !== requestHash) throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different request");
        return { ...structuredClone(prior.response), idempotent_replay: true };
      }
      const { row, state } = await this.getCity(principal, cityId);
      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(state.version)) throw new ServiceError(409, "CITY_VERSION_CONFLICT", "City changed since the preview", { expected: Number(expectedVersion), actual: Number(state.version) });
      const client = memoryClient({ cityId, row, designs, orders, assets });
      const handled = await handler({ client, state, city: row });
      if (handled.nextState) {
        row.state_jsonb = handled.nextState;
        row.city_version = handled.nextState.version;
      }
      receipts.set(receiptKey, { hash: requestHash, response: structuredClone(handled.response) });
      persist();
      return handled.response;
    },

    async ensureSandbox({ displayName, cityInput, scopes }) {
      let playerEntry = [...players.entries()].find(([, player]) => player.displayName === displayName);
      if (!playerEntry) {
        const created = await this.createPlayer(displayName);
        playerEntry = [created.access_token, players.get(created.access_token)];
      }
      const [accessToken, player] = playerEntry;
      const principal = await this.authenticate(accessToken);
      let city = [...cities.values()].find((row) => row.owner_player_id === player.id && row.name === cityInput.name);
      if (!city) {
        const created = await this.createCity(principal, cityInput);
        city = cities.get(created.id);
      }
      const link = await this.createCapability(principal, city.id, { scopes });
      return {
        player: { id: player.id, display_name: player.displayName, access_token: accessToken, token_type: "Bearer" },
        city: citySummary(city),
        link
      };
    },

    listLocalCityAccess() {
      const playerTokensById = new Map([...players.entries()].map(([token, player]) => [player.id, token]));
      const agentTokensByCity = new Map();
      for (const [token, credential] of credentials) {
        if (!credential.revoked) agentTokensByCity.set(credential.cityId, token);
      }
      return [...cities.values()].map((row) => ({
        ...citySummary(row),
        access_token: agentTokensByCity.get(row.id) ?? playerTokensById.get(row.owner_player_id) ?? null
      }));
    },

    async createOwlReport(principal, cityId, submission, idempotencyKey) {
      if (!idempotencyKey) throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
      const receiptKey = `${principal.kind}:${principal.id}:owl-reports:${idempotencyKey}`;
      const requestHash = hashRequest(submission);
      const prior = receipts.get(receiptKey);
      if (prior) {
        if (prior.hash !== requestHash) throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different report");
        return { ...structuredClone(prior.response), idempotent_replay: true };
      }
      await this.getCity(principal, cityId);
      const existing = [...owlReports.values()].find((entry) => entry.city_id === cityId && entry.turn === submission.turn);
      if (existing) {
        if (existing.request_hash === requestHash) {
          return { ...reportResponse(existing), idempotent_replay: true };
        }
        throw new ServiceError(409, "REPORT_ALREADY_EXISTS", `A canonical Owl Report already exists for turn ${submission.turn}`);
      }
      const report = submission.report;
      const entry = {
        id: createId("report"),
        city_id: cityId,
        turn: submission.turn,
        facts_digest: submission.factsDigest,
        edition: report.edition,
        request_hash: requestHash,
        report_jsonb: report,
        created_by_principal_kind: principal.kind,
        created_by_principal_id: principal.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      owlReports.set(entry.id, entry);
      receipts.set(receiptKey, { hash: requestHash, response: structuredClone(reportResponse(entry)) });
      persist();
      return reportResponse(entry);
    },

    async listOwlReports(principal, cityId) {
      await this.getCity(principal, cityId);
      return [...owlReports.values()]
        .filter((entry) => entry.city_id === cityId)
        .sort((a, b) => Number(b.turn) - Number(a.turn))
        .slice(0, 100)
        .map(reportSummary);
    },

    async getOwlReport(principal, cityId, reportId) {
      await this.getCity(principal, cityId);
      const entry = owlReports.get(reportId);
      if (!entry || entry.city_id !== cityId) throw new ServiceError(404, "REPORT_NOT_FOUND", "Owl Report not found");
      return reportResponse(entry);
    },

    async listReportDismissals(principal, cityId) {
      await this.getCity(principal, cityId);
      return Object.fromEntries([...reportDismissals.values()]
        .filter((entry) => entry.city_id === cityId && entry.player_id === principal.id)
        .map((entry) => [Number(entry.report_turn), entry.dismissed_at]));
    },

    async acknowledgeReportDismissal(principal, cityId, reportTurn) {
      requirePlayer(principal);
      await this.getCity(principal, cityId);
      const key = `${cityId}:${principal.id}:${Number(reportTurn)}`;
      reportDismissals.set(key, {
        city_id: cityId,
        player_id: principal.id,
        report_turn: Number(reportTurn),
        dismissed_at: new Date().toISOString()
      });
      persist();
      return { city_id: cityId, player_id: principal.id, report_turn: Number(reportTurn), dismissed: true };
    },

    persistence: { enabled: Boolean(storagePath), storagePath },

    async getAssetJob() { throw new ServiceError(404, "ASSET_JOB_NOT_FOUND", "Asset job not found"); }
  };
  return repository;
}

function memoryClient({ cityId, row, designs, orders, assets }) {
  return {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT status, current_revision, confirmed_revision FROM building_designs")) {
        const design = designs.get(params[0]);
        return design && design.cityId === params[1]
          ? { rowCount: 1, rows: [{ status: design.status, current_revision: design.revision, confirmed_revision: design.confirmedRevision }] }
          : { rowCount: 0, rows: [] };
      }
      if (normalized.startsWith("SELECT * FROM asset_definitions WHERE id = $1 AND status = 'validated'")) {
        const asset = assets.get(params[0]);
        const ownerPlayerId = params[1] ?? null;
        return asset && (asset.ownerPlayerId == null || asset.ownerPlayerId === ownerPlayerId)
          ? { rowCount: 1, rows: [assetRow(asset)] }
          : { rowCount: 0, rows: [] };
      }
      if (normalized.startsWith("INSERT INTO construction_orders")) {
        const isReuse = normalized.includes("'reuse'");
        const requestJson = isReuse ? params[3] : params[2];
        orders.set(params[0], {
          id: params[0],
          city_id: cityId,
          status: "completed",
          asset: { mode: isReuse ? "reuse" : "voxel", asset_id: isReuse ? params[2] : undefined },
          request: JSON.parse(requestJson),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("UPDATE building_designs SET status = 'built'")) {
        const design = designs.get(params[1]);
        if (design) designs.set(params[1], { ...design, status: "built", buildingId: params[0], updatedAt: new Date().toISOString() });
        return { rowCount: design ? 1 : 0, rows: [] };
      }
      if (normalized.startsWith("SELECT * FROM cities WHERE id = $1 FOR UPDATE")) return { rowCount: 1, rows: [row] };
      throw new Error(`Memory repository does not implement SQL used by this route: ${normalized}`);
    }
  };
}

function canAccess(principal, row) { return principal?.kind === "agent" ? principal.cityId === row.id : principal?.id === row.owner_player_id; }
function requirePlayer(principal) { if (principal?.kind !== "player") throw new ServiceError(403, "PLAYER_CREDENTIAL_REQUIRED", "This action requires a player credential"); }
function citySummary(row) { return { id: row.id, name: row.name, visibility: row.visibility, ruleset_version: row.ruleset_version, city_version: Number(row.city_version), turn: row.state_jsonb.turn, turn_kind: Number(row.state_jsonb.turn ?? 0) === 0 ? "bootstrap" : "normal", resources: row.state_jsonb.resources, counts: { districts: Object.keys(row.state_jsonb.districts ?? {}).length, buildings: Object.keys(row.state_jsonb.buildings ?? {}).length, roads: Object.values(row.state_jsonb.cells).filter((cell) => cell.infrastructure === "road").length, pending_orders: 0 } }; }
function assetResponse(asset) { return { id: asset.assetId, owner_player_id: null, archetype: asset.archetype, footprint: asset.footprint, district_style: "london_common", tags: asset.tags, status: "validated", source: "builtin", manifest: asset, match: { score: 1, exact: true, differences: [], recommendation: "reuse" } }; }
function assetRow(asset) { return { id: asset.assetId, owner_player_id: null, archetype: asset.archetype, footprint: asset.footprint, district_style: "london_common", tags: asset.tags, status: "validated", source: "builtin", manifest_jsonb: asset }; }
function reportResponse(row) {
  const report = row.report_jsonb;
  return {
    report_id: row.id,
    city_id: row.city_id,
    turn: Number(row.turn),
    facts_digest: row.facts_digest,
    status: "published",
    edition: report.edition,
    report,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
function reportSummary(row) {
  const report = row.report_jsonb;
  return {
    report_id: row.id,
    city_id: row.city_id,
    turn: Number(row.turn),
    facts_digest: row.facts_digest,
    status: "published",
    edition: report.edition,
    masthead_title: report.masthead?.title ?? null,
    headline: report.headline,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function hydratePersistentState(storagePath, stores) {
  if (!storagePath || !existsSync(storagePath)) return;
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(storagePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read persistent Agent LAN state at ${storagePath}: ${error.message}`);
  }
  if (snapshot.schemaVersion !== 1) throw new Error(`Unsupported Agent LAN state schema: ${snapshot.schemaVersion}`);
  for (const name of ["players", "credentials", "cities", "designs", "orders", "receipts", "owlReports", "reportDismissals"]) {
    for (const [key, value] of snapshot[name] ?? []) stores[name].set(key, value);
  }
  for (const [key, value] of snapshot.capabilities ?? []) {
    stores.capabilities.set(key, { ...value, expiresAt: new Date(value.expiresAt) });
  }
}

function persistState(storagePath, stores) {
  if (!storagePath) return;
  mkdirSync(path.dirname(storagePath), { recursive: true });
  const snapshot = {
    schemaVersion: 1,
    writtenAt: new Date().toISOString(),
    players: [...stores.players],
    credentials: [...stores.credentials],
    capabilities: [...stores.capabilities].map(([key, value]) => [key, {
      ...value,
      expiresAt: value.expiresAt instanceof Date ? value.expiresAt.toISOString() : value.expiresAt
    }]),
    cities: [...stores.cities],
    designs: [...stores.designs],
    orders: [...stores.orders],
    receipts: [...stores.receipts],
    owlReports: [...stores.owlReports],
    reportDismissals: [...stores.reportDismissals]
  };
  const temporaryPath = `${storagePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, storagePath);
}
