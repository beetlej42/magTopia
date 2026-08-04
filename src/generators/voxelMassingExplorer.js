import { createRng } from "../utils/random.js";
import {
  GROUND_TREATMENT_IDS,
  MASS_CAP_IDS,
  MASS_FACADE_ORDER_IDS,
  MASS_PLAN_SHAPE_IDS,
  MASS_RELATION_IDS,
  MASS_TYPE_IDS,
  MASS_VERTICAL_PROFILE_IDS,
  createUrbanMassingSpec,
  normalizeMassingFootprint,
  normalizeVoxelMassingConfig
} from "./voxelMassingGrammar.js";

export const MASSING_EXPLORER_RANDOM_SCOPES = Object.freeze([
  "layout",
  "form",
  "detail",
  "all"
]);

const SITE_USE_SEQUENCE = [null, "mass", "ground", "reserved"];
const WALL_PALETTES = [
  { wall: "brickRed", trim: "sandstone", roof: "slate" },
  { wall: "brickBrown", trim: "limestone", roof: "slate" }
];

export function createExplorerRandomMassingConfig(seed = Date.now(), base = {}, scope = "all") {
  const stableSeed = String(seed);
  const selectedScope = MASSING_EXPLORER_RANDOM_SCOPES.includes(scope) ? scope : "all";
  const rng = createRng(`${stableSeed}:${selectedScope}`);
  let source = selectedScope === "layout" || selectedScope === "all"
    ? createRandomLayout(stableSeed, rng, base)
    : structuredClone(normalizeVoxelMassingConfig(base));

  source.seed = stableSeed;
  source.id = `massing-explorer-${stableSeed}`;
  if (selectedScope === "form" || selectedScope === "all") source = mutateForms(source, rng);
  if (selectedScope === "detail" || selectedScope === "all") source = mutateDetails(source, rng);
  source = enforceRandomMassingQuality(source);
  return normalizeVoxelMassingConfig({
    ...source,
    sunTime: base.sunTime ?? source.sunTime ?? 0.56,
    nightLighting: base.nightLighting ?? source.nightLighting ?? 0.1
  });
}

export function createVoxelMassingExplorer({
  root,
  onApply,
  onRandomize
}) {
  if (!root) throw new Error("Voxel Massing Explorer requires a root element");
  let draft = null;
  let activeMassId = null;
  let diagnostics = null;
  let status = "";

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !root.contains(button)) return;
    const action = button.dataset.action;
    if (action === "randomize") {
      const scope = button.dataset.scope;
      status = `Generating ${scope} variation…`;
      render();
      onRandomize(scope);
      return;
    }
    if (action === "cycle-site") {
      cycleSiteCell(Number(button.dataset.x), Number(button.dataset.z));
      applyDraft();
      return;
    }
    if (action === "toggle-mass-cell") {
      toggleMassCell(Number(button.dataset.x), Number(button.dataset.z));
      applyDraft();
      return;
    }
    if (action === "select-mass") {
      activeMassId = button.dataset.massId;
      render();
      return;
    }
    if (action === "add-mass") {
      addMass();
      applyDraft();
      return;
    }
    if (action === "remove-mass") {
      removeActiveMass();
      applyDraft();
      return;
    }
    if (action === "add-relation") {
      addRelation();
      applyDraft();
      return;
    }
    if (action === "remove-relation") {
      draft.relations.splice(Number(button.dataset.index), 1);
      applyDraft();
      return;
    }
    if (action === "apply-json") {
      const editor = root.querySelector("[data-role='json-editor']");
      try {
        draft = JSON.parse(editor.value);
        activeMassId = draft.masses?.[0]?.id ?? null;
        status = "JSON applied";
        applyDraft();
      } catch (error) {
        status = `JSON error: ${error.message}`;
        render();
      }
      return;
    }
    if (action === "format-json") {
      const editor = root.querySelector("[data-role='json-editor']");
      try {
        editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
        status = "JSON formatted";
      } catch (error) {
        status = `JSON error: ${error.message}`;
      }
      syncStatus();
      return;
    }
    if (action === "copy-json") {
      try {
        await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
        status = "Spec copied";
      } catch {
        status = "Clipboard unavailable";
      }
      syncStatus();
    }
  });

  root.addEventListener("change", (event) => {
    const control = event.target.closest("[data-editor-field]");
    if (!control) return;
    const value = parseControlValue(control);
    if (control.dataset.scope === "mass") {
      const mass = activeMass();
      if (!mass) return;
      setPath(mass, control.dataset.editorField, value);
      if (control.dataset.editorField === "type") applyMassTypeDefaults(mass);
      if (control.dataset.editorField === "facade.order" && value === "classical") {
        applyClassicalFacadeDefaults(mass);
      }
    } else if (control.dataset.scope === "relation") {
      const relation = draft.relations[Number(control.dataset.index)];
      if (!relation) return;
      setPath(relation, control.dataset.editorField, value);
    }
    applyDraft();
  });

  function sync(config, nextDiagnostics = null) {
    draft = structuredClone(config);
    diagnostics = nextDiagnostics;
    if (!draft.masses?.some((mass) => mass.id === activeMassId)) {
      activeMassId = draft.masses?.[0]?.id ?? null;
    }
    status = "";
    render();
  }

  function setVisible(visible) {
    root.hidden = !visible;
  }

  function activeMass() {
    return draft?.masses?.find((mass) => mass.id === activeMassId) ?? null;
  }

  function applyDraft() {
    try {
      const normalized = normalizeVoxelMassingConfig({
        ...createUrbanMassingSpec(draft),
        sunTime: draft.sunTime,
        nightLighting: draft.nightLighting
      });
      draft = normalized;
      if (!draft.masses.some((mass) => mass.id === activeMassId)) {
        activeMassId = draft.masses[0]?.id ?? null;
      }
      status = "Applied";
      onApply(normalized);
    } catch (error) {
      status = error.message;
      render();
    }
  }

  function cycleSiteCell(x, z) {
    const cells = draft.footprint?.cells ?? [];
    const index = cells.findIndex((cell) => cell.x === x && cell.z === z);
    const currentUse = index >= 0 ? cells[index].use : null;
    const nextUse = SITE_USE_SEQUENCE[(SITE_USE_SEQUENCE.indexOf(currentUse) + 1) % SITE_USE_SEQUENCE.length];
    if (nextUse === null) {
      if (cells.length <= 1) {
        status = "A site needs at least one cell";
        return;
      }
      cells.splice(index, 1);
      draft.masses.forEach((mass) => {
        mass.cells = mass.cells.filter((cell) => cell.x !== x || cell.z !== z);
      });
      repairEmptyMasses();
    } else if (index >= 0) {
      cells[index].use = nextUse;
    } else {
      cells.push({ x, z, use: nextUse });
    }
    draft.footprint.cells = cells;
  }

  function toggleMassCell(x, z) {
    const mass = activeMass();
    if (!mass) return;
    const siteCell = draft.footprint.cells.find((cell) => cell.x === x && cell.z === z);
    if (!siteCell) return;
    const index = mass.cells.findIndex((cell) => cell.x === x && cell.z === z);
    if (index >= 0) {
      if (mass.cells.length === 1) {
        status = "A mass needs at least one cell";
        return;
      }
      mass.cells.splice(index, 1);
    } else {
      mass.cells.push({ x, z });
    }
  }

  function repairEmptyMasses() {
    const fallback = draft.footprint.cells.find((cell) => cell.use === "mass")
      ?? draft.footprint.cells[0];
    draft.masses.forEach((mass) => {
      if (!mass.cells.length) mass.cells = [{ x: fallback.x, z: fallback.z }];
    });
  }

  function addMass() {
    const fallback = draft.footprint.cells.find((cell) => cell.use === "mass")
      ?? draft.footprint.cells[0];
    const existing = new Set(draft.masses.map((mass) => mass.id));
    let index = draft.masses.length + 1;
    while (existing.has(`mass-${index}`)) index += 1;
    const mass = {
      id: `mass-${index}`,
      type: "solid",
      cells: [[fallback.x, fallback.z]],
      heightVoxels: 24,
      planShape: "rectangular",
      profile: { type: "uniform" },
      cap: { type: "hip", heightVoxels: 7 },
      facade: { openness: 0.42, entranceEmphasis: 0.5, detailDensity: 0.72 }
    };
    draft.masses.push(mass);
    activeMassId = mass.id;
  }

  function removeActiveMass() {
    if (draft.masses.length <= 1) {
      status = "A composition needs at least one mass";
      render();
      return;
    }
    draft.masses = draft.masses.filter((mass) => mass.id !== activeMassId);
    draft.relations = draft.relations.filter((relation) => (
      relation.from !== activeMassId && relation.to !== activeMassId
    ));
    activeMassId = draft.masses[0].id;
  }

  function addRelation() {
    if (draft.masses.length < 2) {
      status = "Add another mass before creating a relation";
      render();
      return;
    }
    const from = activeMassId ?? draft.masses[0].id;
    const to = draft.masses.find((mass) => mass.id !== from).id;
    draft.relations.push({
      id: `relation-${draft.relations.length + 1}`,
      type: "portal",
      from,
      to,
      widthVoxels: 7,
      heightVoxels: 13
    });
  }

  function render() {
    if (!draft) return;
    const mass = activeMass();
    const siteCells = new Map((draft.footprint?.cells ?? []).map((cell) => [`${cell.x},${cell.z}`, cell]));
    const massCells = new Set((mass?.cells ?? []).map((cell) => `${cell.x},${cell.z}`));
    root.innerHTML = `
      <div class="massing-explorer-heading">
        <div>
          <p class="eyebrow">Generative workspace</p>
          <h2>Massing Explorer</h2>
        </div>
        <span class="massing-seed">${escapeHtml(draft.seed)}</span>
      </div>

      <div class="massing-random-actions" aria-label="Massing randomization controls">
        ${randomButton("layout", "Layout")}
        ${randomButton("form", "Form")}
        ${randomButton("detail", "Detail")}
        ${randomButton("all", "Everything")}
      </div>

      <div class="massing-explorer-section">
        <div class="massing-section-heading">
          <span>3×3 Site</span>
          <small>click: empty → mass → ground → reserved</small>
        </div>
        <div class="massing-grid site-grid" aria-label="Editable 3 by 3 site">
          ${gridButtons((x, z) => {
            const use = siteCells.get(`${x},${z}`)?.use ?? "empty";
            return `<button type="button" class="massing-cell ${use}" data-action="cycle-site" data-x="${x}" data-z="${z}" aria-label="Site ${x + 1},${z + 1}: ${use}"><span>${use === "empty" ? "+" : use[0].toUpperCase()}</span></button>`;
          })}
        </div>
        <div class="massing-grid-legend">
          <span><i class="mass"></i>Mass</span>
          <span><i class="ground"></i>Ground</span>
          <span><i class="reserved"></i>Reserved</span>
        </div>
      </div>

      <div class="massing-explorer-section">
        <div class="massing-section-heading">
          <span>Mass nodes</span>
          <div class="mini-actions">
            <button type="button" data-action="add-mass">Add</button>
            <button type="button" class="quiet" data-action="remove-mass">Remove</button>
          </div>
        </div>
        <div class="massing-tabs">
          ${draft.masses.map((entry) => `
            <button type="button" class="${entry.id === activeMassId ? "active" : ""}" data-action="select-mass" data-mass-id="${escapeAttribute(entry.id)}">
              <strong>${escapeHtml(entry.id)}</strong><small>${escapeHtml(entry.type)}</small>
            </button>
          `).join("")}
        </div>
        ${mass ? renderMassEditor(mass, siteCells, massCells) : ""}
      </div>

      <div class="massing-explorer-section">
        <div class="massing-section-heading">
          <span>Relations</span>
          <button type="button" class="mini-button" data-action="add-relation">Add relation</button>
        </div>
        <div class="relation-list">
          ${draft.relations.length ? draft.relations.map(renderRelation).join("") : `<p class="empty-note">No relations. Masses remain separate.</p>`}
        </div>
      </div>

      <details class="massing-json">
        <summary>JSON spec</summary>
        <textarea data-role="json-editor" spellcheck="false">${escapeHtml(JSON.stringify(draft, null, 2))}</textarea>
        <div class="mini-actions">
          <button type="button" data-action="apply-json">Apply JSON</button>
          <button type="button" class="quiet" data-action="format-json">Format</button>
          <button type="button" class="quiet" data-action="copy-json">Copy</button>
        </div>
      </details>

      ${renderDiagnostics(diagnostics)}
      <p class="massing-explorer-status" data-role="status" role="status">${escapeHtml(status)}</p>
    `;
  }

  function renderMassEditor(mass, siteCells, massCells) {
    const common = `
      ${selectField("Type", "type", MASS_TYPE_IDS, mass.type)}
      ${numberField("Height", "heightVoxels", mass.heightVoxels, 1, 192)}
      ${selectField("Plan", "planShape", MASS_PLAN_SHAPE_IDS, mass.planShape)}
      ${selectField("Profile", "profile.type", MASS_VERTICAL_PROFILE_IDS, mass.profile?.type)}
      ${selectField("Cap", "cap.type", MASS_CAP_IDS, mass.cap?.type)}
      ${numberField("Cap height", "cap.heightVoxels", mass.cap?.heightVoxels ?? 0, 0, 48)}
      ${numberField("Openness", "facade.openness", mass.facade?.openness ?? 0.42, 0, 1, 0.05)}
      ${numberField("Entrance", "facade.entranceEmphasis", mass.facade?.entranceEmphasis ?? 0.5, 0, 1, 0.05)}
    `;
    let specialized = "";
    if (mass.type === "solid") {
      specialized = `
        ${selectField("Facade order", "facade.order", MASS_FACADE_ORDER_IDS, mass.facade?.order ?? "plain")}
        ${mass.facade?.order === "classical" ? `
          ${numberField("Base course", "facade.baseCourseHeightVoxels", mass.facade?.baseCourseHeightVoxels ?? 3, 0, 8)}
          ${numberField("String course", "facade.stringCourseHeightVoxels", mass.facade?.stringCourseHeightVoxels ?? 1, 0, 3)}
          ${numberField("Cornice", "facade.corniceHeightVoxels", mass.facade?.corniceHeightVoxels ?? 3, 0, 5)}
          ${numberField("Corner piers", "facade.cornerPierWidthVoxels", mass.facade?.cornerPierWidthVoxels ?? 2, 0, 5)}
          ${numberField("Pediment", "facade.pedimentHeightVoxels", mass.facade?.pedimentHeightVoxels ?? 0, 0, 16)}
          ${numberField("Chimneys", "facade.rooflineOrnaments", mass.facade?.rooflineOrnaments ?? 0, 0, 8)}
        ` : ""}
      `;
    } else if (mass.type === "framed") {
      specialized = `
        ${numberField("Frame bays", "framing.baySpacingVoxels", mass.framing?.baySpacingVoxels ?? 8, 4, 20)}
        ${numberField("Frame width", "framing.frameWidthVoxels", mass.framing?.frameWidthVoxels ?? 2, 1, 4)}
        ${numberField("Beam spacing", "framing.floorBeamSpacingVoxels", mass.framing?.floorBeamSpacingVoxels ?? 8, 4, 24)}
        ${numberField("Frame relief", "framing.reliefDepthVoxels", mass.framing?.reliefDepthVoxels ?? 1, 0, 2)}
      `;
    } else if (mass.type === "ground") {
      specialized = `
        ${selectField("Ground pattern", "groundTreatment.pattern", GROUND_TREATMENT_IDS, mass.groundTreatment?.pattern)}
        ${numberField("Path width", "groundTreatment.pathWidthVoxels", mass.groundTreatment?.pathWidthVoxels ?? 7, 3, 16)}
        ${numberField("Planters", "groundTreatment.planterCount", mass.groundTreatment?.planterCount ?? 0, 0, 8)}
      `;
    } else if (mass.type === "open") {
      specialized = `
        ${numberField("Column spacing", "enclosure.columnSpacingVoxels", mass.enclosure?.columnSpacingVoxels ?? 8, 4, 20)}
        ${numberField("Column width", "enclosure.columnWidthVoxels", mass.enclosure?.columnWidthVoxels ?? 2, 1, 4)}
        ${numberField("Beam height", "enclosure.beamHeightVoxels", mass.enclosure?.beamHeightVoxels ?? 2, 1, 6)}
      `;
    }
    return `
      <div class="massing-editor-fields">${common}${specialized}</div>
      <div class="massing-section-heading compact">
        <span>Occupied cells</span>
        <small>must remain edge-connected</small>
      </div>
      <div class="massing-grid mass-cell-grid" aria-label="Cells occupied by ${escapeAttribute(mass.id)}">
        ${gridButtons((x, z) => {
          const available = siteCells.has(`${x},${z}`);
          const active = massCells.has(`${x},${z}`);
          return `<button type="button" class="massing-cell ${active ? "selected" : ""}" data-action="toggle-mass-cell" data-x="${x}" data-z="${z}" ${available ? "" : "disabled"} aria-label="${mass.id} cell ${x + 1},${z + 1}: ${active ? "occupied" : "free"}"><span>${active ? "●" : ""}</span></button>`;
        })}
      </div>
    `;
  }

  function renderRelation(relation, index) {
    const massIds = draft.masses.map((mass) => mass.id);
    return `
      <div class="relation-row">
        ${selectField("Type", "type", MASS_RELATION_IDS, relation.type, "relation", index)}
        ${selectField("From", "from", massIds, relation.from, "relation", index)}
        ${selectField("To", "to", massIds, relation.to, "relation", index)}
        <button type="button" class="relation-remove" data-action="remove-relation" data-index="${index}" aria-label="Remove relation ${index + 1}">×</button>
      </div>
    `;
  }

  function selectField(label, path, options, value, scope = "mass", index = null) {
    return `
      <label class="massing-field">
        <span>${escapeHtml(label)}</span>
        <select data-editor-field="${escapeAttribute(path)}" data-scope="${scope}" ${index === null ? "" : `data-index="${index}"`}>
          ${options.map((option) => `<option value="${escapeAttribute(option)}" ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(titleCase(option))}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function numberField(label, path, value, min, max, step = 1) {
    return `
      <label class="massing-field">
        <span>${escapeHtml(label)}</span>
        <input type="number" min="${min}" max="${max}" step="${step}" value="${Number(value)}" data-editor-field="${escapeAttribute(path)}" data-scope="mass" />
      </label>
    `;
  }

  function syncStatus() {
    const output = root.querySelector("[data-role='status']");
    if (output) output.textContent = status;
  }

  return { sync, setVisible };
}

function createRandomLayout(seed, rng, base) {
  const family = pick(rng, ["tower-court", "garden-hall", "civic-axis", "guild-court"]);
  const wide = family !== "tower-court";
  const width = wide ? 3 : 2;
  const cells = Array.from({ length: 2 }, (_, z) => (
    Array.from({ length: width }, (__, x) => ({ x, z, use: z === 0 ? "mass" : "ground" }))
  )).flat();
  const frontCells = Array.from({ length: width }, (_, x) => [x, 1]);
  let masses;
  let relations;

  if (family === "garden-hall") {
    masses = [
      baseSolid("garden-house", "primary", [[0, 0]], 30),
      {
        id: "glass-hall",
        role: "secondary",
        type: "framed",
        cells: [[1, 0], [2, 0]],
        heightVoxels: 12,
        planShape: "rectangular",
        orientation: "east",
        cap: { type: "glass_barrel", heightVoxels: 15, orientation: "east_west" }
      },
      baseArcade("entry-arcade", [[0, 1]]),
      baseGround("garden-court", frontCells, "garden")
    ];
    relations = [portal("house-glass", "garden-house", "glass-hall", 8, 14)];
  } else if (family === "civic-axis") {
    masses = [
      baseSolid("west-wing", "secondary", [[0, 0]], 23),
      baseSolid("central-hall", "primary", [[1, 0]], 32),
      baseSolid("east-wing", "secondary", [[2, 0]], 23),
      baseHero("dome-drum", [[1, 0]], "dome"),
      baseArcade("front-portico", [[1, 1]], "gable"),
      baseGround("civic-plaza", frontCells, "courtyard")
    ];
    relations = [
      portal("west-hall", "west-wing", "central-hall"),
      portal("hall-east", "central-hall", "east-wing"),
      { id: "hall-dome", type: "stacked", from: "central-hall", to: "dome-drum" }
    ];
  } else if (family === "guild-court") {
    const heroSide = rng() < 0.5 ? 0 : 2;
    masses = [
      baseSolid("guild-wing-a", "secondary", [[0, 0]], 23),
      baseSolid("guild-hall", "primary", [[1, 0]], 31),
      baseSolid("guild-wing-b", "secondary", [[2, 0]], 25),
      baseHero("guild-lantern", [[heroSide, 0]], rng() < 0.5 ? "spire" : "dome"),
      baseArcade("court-arcade", [[heroSide === 0 ? 2 : 0, 1]]),
      baseGround("guild-court", frontCells, "bordered")
    ];
    relations = [
      portal("guild-link-a", "guild-wing-a", "guild-hall"),
      portal("guild-link-b", "guild-hall", "guild-wing-b"),
      {
        id: "guild-hero",
        type: "stacked",
        from: heroSide === 0 ? "guild-wing-a" : "guild-wing-b",
        to: "guild-lantern"
      }
    ];
  } else {
    masses = [
      baseSolid("main", "primary", [[0, 0]], 29),
      baseSolid("side-wing", "secondary", [[1, 0]], 22),
      baseHero("tower", [[0, 0]], "spire"),
      baseArcade("entry-arcade", [[0, 1]]),
      baseGround("court", frontCells, "courtyard")
    ];
    relations = [
      portal("main-wing", "main", "side-wing"),
      { id: "tower-stack", type: "stacked", from: "main", to: "tower" }
    ];
  }

  return {
    id: `massing-explorer-${seed}`,
    seed,
    viewFraming: { horizontalOffset: wide ? 2.6 : 1.6, zoom: wide ? 1.16 : 1.1 },
    sunTime: base.sunTime ?? 0.56,
    nightLighting: base.nightLighting ?? 0.1,
    footprint: { cells },
    masses,
    relations
  };
}

function mutateForms(source, rng) {
  source.masses = source.masses.map((mass) => {
    const next = structuredClone(mass);
    const stackedChild = source.relations.some((relation) => (
      relation.type === "stacked" && relation.to === next.id
    ));
    if (next.type === "ground") {
      next.heightVoxels = 2;
      next.cap = { type: "flat" };
      return next;
    }
    if (next.type === "framed") {
      next.heightVoxels = integer(rng, 10, 14);
      next.planShape = "rectangular";
      next.profile = { type: "uniform" };
      next.cap = {
        type: "glass_barrel",
        heightVoxels: integer(rng, 13, 17),
        orientation: next.cells.length > 1 ? "east_west" : pick(rng, ["east_west", "north_south"]),
        ribCount: pick(rng, [7, 9, 11]),
        ringCount: integer(rng, 1, 3),
        finialHeightVoxels: integer(rng, 3, 5)
      };
    } else if (next.type === "open") {
      next.heightVoxels = integer(rng, 13, 16);
      next.planShape = "rectangular";
      next.profile = { type: "uniform" };
      next.cap = {
        type: pick(rng, ["parapet", "parapet", "gable"]),
        heightVoxels: integer(rng, 5, 8),
        parapetHeightVoxels: 3,
        orientation: "north_south",
        ridgeRailHeightVoxels: 1
      };
      next.dimensionsVoxels = { width: integer(rng, 26, 30), depth: integer(rng, 10, 13) };
      next.placement = { ...(next.placement ?? {}), offsetVoxels: { z: -9 } };
    } else {
      const entrance = next.role === "entrance";
      next.heightVoxels = stackedChild
        ? integer(rng, 34, 39)
        : entrance
          ? integer(rng, 12, 16)
          : next.role === "primary"
            ? integer(rng, 28, 34)
            : integer(rng, 20, 26);
      next.planShape = stackedChild
        ? pick(rng, ["chamfered", "octagonal"])
        : pick(rng, ["rectangular", "rectangular", "chamfered"]);
      next.orientation = "south";
      next.profile = {
        type: stackedChild ? pick(rng, ["stepped", "tapered"]) : pick(rng, ["uniform", "uniform", "stepped"]),
        stepHeightVoxels: stackedChild ? integer(rng, 10, 14) : integer(rng, 14, 18),
        stepVoxels: 1,
        maxInsetVoxels: stackedChild ? integer(rng, 6, 9) : 4
      };
      next.cap = {
        type: stackedChild
          ? pick(rng, ["spire", "dome"])
          : pick(rng, ["gable", "hip", "mansard"]),
        heightVoxels: stackedChild ? integer(rng, 12, 16) : integer(rng, 7, 10),
        orientation: pick(rng, ["east_west", "north_south"]),
        ridgeRatio: decimal(rng, 0.42, 0.58),
        dormerCount: stackedChild ? 0 : integer(rng, 1, 2),
        ridgeRailHeightVoxels: 1,
        ribCount: stackedChild ? 8 : 0,
        ringCount: stackedChild ? integer(rng, 1, 2) : 0,
        finialHeightVoxels: stackedChild ? integer(rng, 3, 5) : 0
      };
      if (stackedChild) {
        const width = integer(rng, 16, 19);
        next.dimensionsVoxels = { width, depth: width };
        next.placement = {
          ...(next.placement ?? {}),
          setbacksVoxels: { north: 5, east: 5, south: 5, west: 5 }
        };
      }
    }
    return next;
  });
  return source;
}

function mutateDetails(source, rng) {
  const compositionPalette = pick(rng, WALL_PALETTES);
  const stackedIds = new Set(source.relations
    .filter((relation) => relation.type === "stacked")
    .map((relation) => relation.to));
  const solids = source.masses.filter((mass) => mass.type === "solid" && !stackedIds.has(mass.id));
  const entranceId = solids.find((mass) => mass.role === "entrance")?.id
    ?? solids.find((mass) => mass.role === "primary")?.id
    ?? solids[0]?.id;
  source.masses = source.masses.map((mass) => {
    const next = structuredClone(mass);
    next.materials = { ...(next.materials ?? {}), ...compositionPalette };
    const primarySolid = next.type === "solid" && next.id === entranceId;
    const classical = next.type === "solid";
    const stacked = stackedIds.has(next.id);
    next.facade = {
      ...(next.facade ?? {}),
      symmetry: decimal(rng, 0.72, 1),
      openness: next.type === "framed"
        ? decimal(rng, 0.78, 0.9)
        : next.type === "solid"
          ? decimal(rng, stacked ? 0.26 : 0.3, stacked ? 0.38 : 0.46)
          : 1,
      entranceEmphasis: next.type === "solid" ? (primarySolid ? 1 : 0) : 0,
      entranceFace: "south",
      detailDensity: decimal(rng, stacked ? 0.76 : 0.82, stacked ? 0.86 : 0.96),
      floorHeightVoxels: pick(rng, [10, 12, 14]),
      bayWidthVoxels: pick(rng, [8, 8, 10]),
      order: next.type === "solid" ? "classical" : "plain",
      baseCourseHeightVoxels: classical ? 2 : 0,
      stringCourseHeightVoxels: classical ? 1 : 0,
      corniceHeightVoxels: classical ? 2 : 0,
      cornerPierWidthVoxels: classical ? 1 : 0,
      pedimentHeightVoxels: classical && primarySolid ? integer(rng, 4, 6) : 0,
      pedimentWidthVoxels: classical && primarySolid ? integer(rng, 14, 20) : 0,
      rooflineOrnaments: classical && !stacked ? integer(rng, 1, 2) : 0,
      accentWindow: stacked ? {
        type: "oculus",
        face: "south",
        diameterVoxels: pick(rng, [7, 9, 11]),
        centerYRatio: decimal(rng, 0.62, 0.72),
        material: "violetMagic"
      } : next.facade?.accentWindow
    };
    if (next.type === "framed") {
      next.materials = { ...next.materials, frame: "limestone", trim: "limestone", panel: "lightGlass" };
      next.framing = {
        baySpacingVoxels: integer(rng, 6, 11),
        frameWidthVoxels: integer(rng, 1, 2),
        floorBeamSpacingVoxels: integer(rng, 6, 12),
        reliefDepthVoxels: integer(rng, 0, 2)
      };
    }
    if (next.type === "open") {
      next.materials = {
        ...next.materials,
        wall: compositionPalette.trim,
        frame: compositionPalette.trim,
        trim: compositionPalette.trim
      };
      next.enclosure = {
        sides: {
          north: "auto",
          east: "open",
          south: "columns",
          west: "open"
        },
        columnSpacingVoxels: pick(rng, [7, 8, 9]),
        columnWidthVoxels: 2,
        beamHeightVoxels: 2,
        plinthHeightVoxels: 1,
        archRiseVoxels: integer(rng, 5, 7),
        archThicknessVoxels: 2,
        capitalHeightVoxels: 2
      };
    }
    if (next.type === "ground") {
      next.groundTreatment = {
        pattern: pick(rng, ["courtyard", "garden", "garden"]),
        borderWidthVoxels: integer(rng, 1, 2),
        pathWidthVoxels: integer(rng, 7, 11),
        axisMaterial: "stoneShadow",
        planterCount: integer(rng, 6, 8),
        fenceHeightVoxels: 3,
        lampCount: integer(rng, 6, 8),
        stepWidthVoxels: integer(rng, 14, 24),
        stepDepthVoxels: integer(rng, 4, 8)
      };
    }
    return next;
  });
  source.relations = source.relations.map((relation) => ({
    ...relation,
    finish: relation.type === "portal"
      ? { trimWidthVoxels: integer(rng, 1, 2), thresholdVoxels: 1 }
      : relation.type === "stacked"
        ? { baseCourseHeightVoxels: integer(rng, 1, 3), apronWidthVoxels: integer(rng, 1, 2) }
        : {}
  }));
  return source;
}

function baseSolid(id, role, cells, heightVoxels) {
  return {
    id,
    role,
    type: "solid",
    cells,
    heightVoxels,
    planShape: "rectangular",
    cap: { type: role === "primary" ? "hip" : "gable", heightVoxels: 8 },
    facade: { entranceEmphasis: role === "primary" ? 1 : 0, entranceFace: "south" }
  };
}

function baseHero(id, cells, capType) {
  return {
    id,
    role: "crown",
    type: "solid",
    cells,
    dimensionsVoxels: { width: 18, depth: 18 },
    placement: { setbacksVoxels: { north: 5, east: 5, south: 5, west: 5 } },
    heightVoxels: 37,
    planShape: "octagonal",
    profile: { type: "tapered", stepHeightVoxels: 12, stepVoxels: 1 },
    cap: { type: capType, heightVoxels: 15, ribCount: 8, ringCount: 1, finialHeightVoxels: 4 },
    facade: { entranceEmphasis: 0, openness: 0.32 }
  };
}

function baseArcade(id, cells, capType = "parapet") {
  return {
    id,
    role: "entrance-frame",
    type: "open",
    cells,
    dimensionsVoxels: { width: 28, depth: 12 },
    placement: { offsetVoxels: { z: -9 } },
    heightVoxels: 14,
    cap: { type: capType, heightVoxels: capType === "gable" ? 7 : 0, parapetHeightVoxels: 3 },
    enclosure: {
      sides: { north: "auto", east: "open", south: "columns", west: "open" },
      columnSpacingVoxels: 8,
      columnWidthVoxels: 2,
      beamHeightVoxels: 2,
      plinthHeightVoxels: 1,
      archRiseVoxels: 6,
      archThicknessVoxels: 2,
      capitalHeightVoxels: 2
    }
  };
}

function baseGround(id, cells, pattern) {
  return {
    id,
    role: "site",
    type: "ground",
    cells,
    heightVoxels: 2,
    cap: { type: "flat" },
    groundTreatment: {
      pattern,
      borderWidthVoxels: 1,
      pathWidthVoxels: 9,
      axisMaterial: "stoneShadow",
      planterCount: 6,
      fenceHeightVoxels: 3,
      lampCount: 6,
      stepWidthVoxels: 20,
      stepDepthVoxels: 6
    }
  };
}

function portal(id, from, to, widthVoxels = 7, heightVoxels = 13) {
  return { id, type: "portal", from, to, widthVoxels, heightVoxels };
}

function enforceRandomMassingQuality(source) {
  const next = structuredClone(source);
  const stackedIds = new Set(next.relations
    .filter((relation) => relation.type === "stacked")
    .map((relation) => relation.to));
  const solids = next.masses.filter((mass) => mass.type === "solid");
  const entrance = solids.find((mass) => mass.role === "entrance")
    ?? solids.find((mass) => mass.role === "primary" && !stackedIds.has(mass.id))
    ?? solids.find((mass) => !stackedIds.has(mass.id));

  next.viewFraming = {
    horizontalOffset: next.footprint?.cells?.some((cell) => cell.x >= 2) ? 2.7 : 1.6,
    zoom: next.footprint?.cells?.some((cell) => cell.x >= 2) ? 1.16 : 1.1
  };
  next.masses = next.masses.map((mass) => {
    const repaired = structuredClone(mass);
    if (repaired.type === "solid") {
      repaired.materials = {
        ...(repaired.materials ?? {}),
        wall: ["brickRed", "brickBrown"].includes(repaired.materials?.wall)
          ? repaired.materials.wall
          : "brickBrown",
        trim: repaired.materials?.trim === "sandstone" ? "sandstone" : "limestone",
        roof: "slate"
      };
      repaired.facade = {
        ...(repaired.facade ?? {}),
        entranceEmphasis: repaired.id === entrance?.id ? 1 : 0,
        entranceFace: "south",
        openness: Math.min(stackedIds.has(repaired.id) ? 0.38 : 0.46, repaired.facade?.openness ?? 0.38),
        detailDensity: stackedIds.has(repaired.id)
          ? Math.min(0.86, Math.max(0.76, repaired.facade?.detailDensity ?? 0))
          : Math.min(0.96, Math.max(0.82, repaired.facade?.detailDensity ?? 0)),
        order: "classical",
        baseCourseHeightVoxels: 2,
        stringCourseHeightVoxels: 1,
        corniceHeightVoxels: 2,
        cornerPierWidthVoxels: 1,
        pedimentHeightVoxels: repaired.id === entrance?.id
          ? Math.min(6, repaired.facade?.pedimentHeightVoxels ?? 5)
          : 0,
        pedimentWidthVoxels: repaired.id === entrance?.id
          ? Math.min(20, repaired.facade?.pedimentWidthVoxels ?? 16)
          : 0,
        rooflineOrnaments: stackedIds.has(repaired.id)
          ? 0
          : Math.min(2, Math.max(1, repaired.facade?.rooflineOrnaments ?? 0))
      };
      if (stackedIds.has(repaired.id)) {
        repaired.dimensionsVoxels ??= { width: 19, depth: 19 };
        repaired.dimensionsVoxels.width = Math.min(19, repaired.dimensionsVoxels.width);
        repaired.dimensionsVoxels.depth = Math.min(19, repaired.dimensionsVoxels.depth);
        repaired.heightVoxels = Math.min(39, repaired.heightVoxels);
        repaired.planShape = ["chamfered", "octagonal"].includes(repaired.planShape)
          ? repaired.planShape
          : "octagonal";
        repaired.cap = {
          ...(repaired.cap ?? {}),
          type: ["spire", "dome"].includes(repaired.cap?.type) ? repaired.cap.type : "spire",
          heightVoxels: Math.min(16, Math.max(12, repaired.cap?.heightVoxels ?? 0)),
          ribCount: Math.max(8, repaired.cap?.ribCount ?? 0),
          ringCount: Math.max(1, repaired.cap?.ringCount ?? 0),
          finialHeightVoxels: Math.max(3, repaired.cap?.finialHeightVoxels ?? 0)
        };
        repaired.facade.accentWindow = {
          type: "oculus",
          face: "south",
          diameterVoxels: repaired.facade?.accentWindow?.diameterVoxels ?? 9,
          centerYRatio: repaired.facade?.accentWindow?.centerYRatio ?? 0.68,
          material: "violetMagic"
        };
      }
    } else if (repaired.type === "framed") {
      repaired.heightVoxels = Math.min(14, repaired.heightVoxels);
      repaired.planShape = "rectangular";
      repaired.cap = {
        ...(repaired.cap ?? {}),
        type: "glass_barrel",
        heightVoxels: Math.max(13, repaired.cap?.heightVoxels ?? 0),
        ribCount: Math.max(7, repaired.cap?.ribCount ?? 0),
        ringCount: Math.max(1, repaired.cap?.ringCount ?? 0)
      };
      repaired.materials = {
        ...(repaired.materials ?? {}),
        frame: "limestone",
        trim: "limestone",
        panel: "lightGlass"
      };
    } else if (repaired.type === "open") {
      repaired.heightVoxels = Math.max(13, Math.min(17, repaired.heightVoxels));
      repaired.dimensionsVoxels ??= { width: 28, depth: 12 };
      repaired.dimensionsVoxels.depth = Math.min(14, repaired.dimensionsVoxels.depth);
      repaired.materials = {
        ...(repaired.materials ?? {}),
        wall: repaired.materials?.trim === "sandstone" ? "sandstone" : "limestone",
        frame: repaired.materials?.trim === "sandstone" ? "sandstone" : "limestone",
        trim: repaired.materials?.trim === "sandstone" ? "sandstone" : "limestone"
      };
      repaired.enclosure = {
        ...(repaired.enclosure ?? {}),
        sides: { north: "auto", east: "open", south: "columns", west: "open" },
        columnSpacingVoxels: repaired.enclosure?.columnSpacingVoxels ?? 8,
        columnWidthVoxels: Math.max(2, repaired.enclosure?.columnWidthVoxels ?? 0),
        beamHeightVoxels: Math.max(2, repaired.enclosure?.beamHeightVoxels ?? 0),
        plinthHeightVoxels: Math.max(1, repaired.enclosure?.plinthHeightVoxels ?? 0),
        archRiseVoxels: Math.max(5, repaired.enclosure?.archRiseVoxels ?? 0),
        archThicknessVoxels: Math.max(2, repaired.enclosure?.archThicknessVoxels ?? 0),
        capitalHeightVoxels: Math.max(2, repaired.enclosure?.capitalHeightVoxels ?? 0)
      };
    } else if (repaired.type === "ground") {
      repaired.heightVoxels = 2;
      repaired.cap = { type: "flat" };
      repaired.groundTreatment = {
        ...(repaired.groundTreatment ?? {}),
        pattern: repaired.groundTreatment?.pattern === "plain" ? "courtyard" : repaired.groundTreatment?.pattern,
        borderWidthVoxels: Math.max(1, repaired.groundTreatment?.borderWidthVoxels ?? 0),
        pathWidthVoxels: Math.max(7, repaired.groundTreatment?.pathWidthVoxels ?? 0),
        axisMaterial: "stoneShadow",
        planterCount: Math.max(6, repaired.groundTreatment?.planterCount ?? 0),
        fenceHeightVoxels: Math.max(3, repaired.groundTreatment?.fenceHeightVoxels ?? 0),
        lampCount: Math.max(6, repaired.groundTreatment?.lampCount ?? 0),
        stepWidthVoxels: Math.max(14, repaired.groundTreatment?.stepWidthVoxels ?? 0),
        stepDepthVoxels: Math.max(4, repaired.groundTreatment?.stepDepthVoxels ?? 0)
      };
    }
    return repaired;
  });
  next.relations = next.relations.map((relation) => ({
    ...relation,
    finish: relation.type === "portal"
      ? {
          trimWidthVoxels: Math.max(1, relation.finish?.trimWidthVoxels ?? 0),
          thresholdVoxels: Math.max(1, relation.finish?.thresholdVoxels ?? 0)
        }
      : relation.type === "stacked"
        ? {
            baseCourseHeightVoxels: Math.max(2, relation.finish?.baseCourseHeightVoxels ?? 0),
            apronWidthVoxels: Math.max(1, relation.finish?.apronWidthVoxels ?? 0)
          }
        : relation.finish
  }));
  return next;
}

function applyMassTypeDefaults(mass) {
  if (mass.type === "ground") {
    mass.heightVoxels = Math.min(3, mass.heightVoxels ?? 2);
    mass.cap = { type: "flat" };
    mass.groundTreatment ??= { pattern: "bordered", pathWidthVoxels: 7, planterCount: 0 };
  } else if (mass.type === "framed") {
    mass.cap = { type: "glass_ridge", heightVoxels: 8 };
    mass.framing ??= { baySpacingVoxels: 8, frameWidthVoxels: 2, floorBeamSpacingVoxels: 8, reliefDepthVoxels: 1 };
  } else if (mass.type === "open") {
    mass.cap ??= { type: "parapet", parapetHeightVoxels: 3 };
    mass.enclosure ??= { sides: { north: "auto", east: "columns", south: "columns", west: "columns" } };
  }
}

function applyClassicalFacadeDefaults(mass) {
  mass.facade = {
    ...(mass.facade ?? {}),
    order: "classical",
    baseCourseHeightVoxels: mass.facade?.baseCourseHeightVoxels || 3,
    stringCourseHeightVoxels: mass.facade?.stringCourseHeightVoxels || 1,
    corniceHeightVoxels: mass.facade?.corniceHeightVoxels || 3,
    cornerPierWidthVoxels: mass.facade?.cornerPierWidthVoxels || 2
  };
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics) return "";
  const metrics = [
    ["Masses", diagnostics.massCount],
    ["Relations", diagnostics.relationCount],
    ["Openings", diagnostics.massPlans?.reduce((total, mass) => total + mass.facadeFeatureCount, 0) ?? 0],
    ["Voxels", compactNumber(diagnostics.instanceCount)],
    ["Draw calls", diagnostics.drawCalls],
    ["Finishes", compactNumber(diagnostics.relationFinishVoxels ?? 0)]
  ];
  return `
    <div class="massing-diagnostics" aria-label="Massing diagnostics">
      ${metrics.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
    </div>
  `;
}

function gridButtons(factory) {
  return Array.from({ length: 3 }, (_, z) => (
    Array.from({ length: 3 }, (__, x) => factory(x, z)).join("")
  )).join("");
}

function randomButton(scope, label) {
  return `<button type="button" data-action="randomize" data-scope="${scope}"><span>${label}</span><small>${scope === "layout" ? "cells + nodes" : scope === "form" ? "shape + roof" : scope === "detail" ? "facade + site" : "new composition"}</small></button>`;
}

function parseControlValue(control) {
  return control.type === "number" ? Number(control.value) : control.value;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] ??= {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function integer(rng, minimum, maximum) {
  return minimum + Math.floor(rng() * (maximum - minimum + 1));
}

function decimal(rng, minimum, maximum) {
  return Number((minimum + rng() * (maximum - minimum)).toFixed(3));
}

function compactNumber(value) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
}

function titleCase(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\"", "&quot;");
}
