import * as THREE from "three";
import { getVoxelSphereFrame } from "../generators/voxelIntentDistrict.js";
import { createCityInfoWorldLayer } from "./cityInfoWorldLayer.js";

const CARD_BASE_WIDTH = 198;
const CARD_BASE_HEIGHT = 70;
const CARD_GAP_PX = 22;
const MIN_CARD_SCALE = 0.78;
const MAX_CARD_SCALE = 1.16;
const SELECTION_DELAY_MS = 125;
const SELECTION_RADIUS_NDC = 0.28;
const BLOCK_SELECTION_RADIUS_NDC = 0.85;
const BUILDING_SEARCH_CELL_RADIUS = 2;

const cameraPointScratch = new THREE.Vector3();
const ndcPointScratch = new THREE.Vector3();

const PURPOSE_LABELS = {
  residential: "Residence",
  workshop: "Workshop",
  visitor_service: "Visitor service",
  commercial: "Shop",
  mixed_use: "Mixed use",
  public: "Public building"
};

const STATUS_LABELS = {
  completed: "Active",
  reserved: "Reserved",
  construction: "Under construction",
  blocked: "Blocked"
};

export function createCityInfoOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "city-info-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const worldLayer = createCityInfoWorldLayer();

  const leader = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leader.classList.add("city-info-leader");
  leader.setAttribute("aria-hidden", "true");

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.classList.add("city-info-leader-line");
  leader.append(line);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "city-info-card";
  card.setAttribute("aria-label", "Open city information");
  card.innerHTML = [
    '<span class="city-info-kicker"></span>',
    '<span class="city-info-title"></span>',
    '<span class="city-info-subtitle"></span>'
  ].join("");

  overlay.append(leader, card);
  document.body.append(overlay);

  const state = {
    root: null,
    context: null,
    active: null,
    pendingKey: null,
    pendingSince: 0,
    opacity: 0,
    blockOverlayOpacity: 0,
    lastBlockKey: null,
    lastBlockBoundaryEdges: [],
    detailTarget: null,
    suppressed: false
  };

  card.addEventListener("click", () => {
    if (!state.active) return;
    overlay.dispatchEvent(new CustomEvent("city-info:open-detail", {
      detail: structuredClone(state.detailTarget ?? state.active)
    }));
  });

  function setSceneRoot(root = null) {
    worldLayer.setSceneRoot(root);
    state.root = root;
    state.context = root ? createCityInfoContext(root) : null;
    state.active = null;
    state.pendingKey = null;
    state.pendingSince = 0;
    state.detailTarget = null;
    state.opacity = 0;
    state.blockOverlayOpacity = 0;
    state.lastBlockKey = null;
    state.lastBlockBoundaryEdges = [];
    state.suppressed = false;
    overlay.classList.toggle("is-enabled", Boolean(root));
    overlay.setAttribute("aria-hidden", root ? "false" : "true");
  }

  function update({ camera, delta = 0.016, viewMode = "far", viewport, enabled = true }) {
    if (!enabled) {
      if (!state.suppressed) {
        state.opacity = 0;
        state.blockOverlayOpacity = 0;
        worldLayer.update({
          geometryKey: state.lastBlockKey,
          boundaryEdges: state.lastBlockBoundaryEdges,
          opacity: 0,
          targetOpacity: 0,
          frameVisible: false,
          targetVisible: false
        });
        applyOpacity();
        state.suppressed = true;
      }
      return;
    }
    state.suppressed = false;
    const root = state.root;
    const context = state.context;
    if (!root || !context || !camera || !viewport?.width || !viewport?.height) {
      state.opacity = approach(state.opacity, 0, delta, 14);
      applyOpacity();
      return;
    }

    const selection = resolveSelection(context, camera, viewMode);
    const now = performance.now();

    if (selection?.key !== state.pendingKey) {
      state.pendingKey = selection?.key ?? null;
      state.pendingSince = now;
    }

    if (now - state.pendingSince >= SELECTION_DELAY_MS) {
      if ((selection?.key ?? null) !== (state.active?.key ?? null)) {
        state.active = selection;
        state.detailTarget = selection?.detailTarget ?? null;
        if (selection) {
          if (selection.kind === "block") {
            state.lastBlockKey = selection.key;
            state.lastBlockBoundaryEdges = selection.boundaryEdges ?? [];
          }
          updateCardContent(selection);
          card.classList.toggle("is-parcel", selection.kind === "parcel");
          card.classList.toggle("is-block", selection.kind === "block");
          card.classList.toggle("is-building", selection.kind === "building");
        }
      }
    }

    const shouldShow = Boolean(state.active && selection && state.active.key === selection.key);
    state.opacity = approach(state.opacity, shouldShow ? 1 : 0, delta, shouldShow ? 13 : 16);
    const blockShouldShow = Boolean(state.active?.kind === "block" && shouldShow);
    state.blockOverlayOpacity = approach(
      state.blockOverlayOpacity,
      blockShouldShow ? 1 : 0,
      delta,
      blockShouldShow ? 13 : 16
    );
    const hasBlockVisual = Boolean(
      state.lastBlockBoundaryEdges.length > 0
      && state.blockOverlayOpacity > 0.001
    );
    const planetCenter = context.planetCenter;

    if (state.active) {
      const screen = projectToScreen(state.active.anchorWorld, camera, viewport);
      const targetScreen = projectToScreen(state.active.targetWorld ?? state.active.anchorWorld, camera, viewport);
      if (!screen.visible || !targetScreen.visible) {
        state.opacity = approach(state.opacity, 0, delta, 16);
        state.blockOverlayOpacity = approach(state.blockOverlayOpacity, 0, delta, 16);
        worldLayer.update({
          geometryKey: state.lastBlockKey,
          boundaryEdges: state.lastBlockBoundaryEdges,
          opacity: state.blockOverlayOpacity,
          targetOpacity: 0,
          frameVisible: hasBlockVisual,
          targetVisible: false
        });
      } else {
        const scale = getDepthScale(state.active.anchorWorld, camera);
        const cardX = clamp(screen.x, 24, viewport.width - 24);
        const cardY = screen.y - CARD_GAP_PX * scale;
        card.style.left = cardX + "px";
        card.style.top = cardY + "px";
        card.style.transform = "translate(-50%, -100%) scale(" + (scale * (0.94 + state.opacity * 0.06)) + ")";
        leader.setAttribute("viewBox", "0 0 " + viewport.width + " " + viewport.height);
        line.setAttribute("x1", String(cardX));
        line.setAttribute("y1", String(cardY));
        line.setAttribute("x2", String(targetScreen.x));
        line.setAttribute("y2", String(targetScreen.y));
        card.style.setProperty("--card-depth-scale", String(scale));

        worldLayer.update({
          geometryKey: state.lastBlockKey,
          boundaryEdges: state.lastBlockBoundaryEdges,
          targetWorld: state.active.targetWorld ?? state.active.anchorWorld,
          targetNormal: state.active.targetNormal,
          opacity: state.blockOverlayOpacity,
          targetOpacity: state.opacity,
          frameVisible: hasBlockVisual,
          targetVisible: shouldShow
        });
      }
    }

    if (!state.active || !shouldShow) {
      worldLayer.update({
        geometryKey: state.lastBlockKey,
        boundaryEdges: state.lastBlockBoundaryEdges,
        opacity: state.blockOverlayOpacity,
        targetOpacity: 0,
        frameVisible: hasBlockVisual,
        targetVisible: false
      });
    }

    applyOpacity();
  }

  function updateCardContent(selection) {
    const kicker = card.querySelector(".city-info-kicker");
    const title = card.querySelector(".city-info-title");
    const subtitle = card.querySelector(".city-info-subtitle");
    kicker.textContent = selection.kicker;
    title.textContent = selection.title;
    subtitle.textContent = selection.subtitle;
    card.setAttribute("aria-label", selection.title + ". " + selection.subtitle);
  }

  function applyOpacity() {
    const visible = state.opacity > 0.01;
    overlay.classList.toggle("is-visible", visible);
    overlay.style.setProperty("--city-info-opacity", String(state.opacity));
    card.style.opacity = String(state.opacity);
    leader.style.opacity = String(state.opacity);
  }

  return {
    setSceneRoot,
    update,
    element: overlay
  };
}

export function createCityInfoContext(root) {
  const state = root.userData?.cityState ?? {};
  const world = root.userData?.worldContract ?? {};
  const grid = world.grid ?? state.world?.grid ?? {};
  const buildingsRoot = root.getObjectByName("AgentAcceptanceBuildings");
  const placements = buildingsRoot?.userData?.contract?.placements ?? [];
  root.updateWorldMatrix(true, true);
  const buildingObjectsById = findBuildingObjects(root);
  // Cancellation preserves the district in the agent-facing history, but a
  // released planning context must not remain selectable in the city view.
  const districts = Object.values(state.districts ?? {}).filter((district) => district.status !== "cancelled");
  const gridCells = Array.isArray(grid.cells)
    ? grid.cells
    : Object.values(state.cells ?? {});
  const cellsByCoord = new Map(
    gridCells.map((cell) => [
      `${Number(cell.column)}:${Number(cell.row)}`,
      state.cells?.[cell.id] ?? cell
    ])
  );
  const buildingIdsByDistrict = new Map(districts.map((district) => [district.id, new Set()]));
  Object.values(state.buildings ?? {}).forEach((building) => {
    districts.forEach((district) => {
      const explicitlyAssigned = building.districtId === district.id
        || building.program?.attributes?.districtId === district.id;
      const insideBounds = (building.footprintCells ?? []).some((cellId) => (
        isCellWithinBlock(state.cells?.[cellId] ?? {}, district.bounds)
      ));
      if (explicitlyAssigned || insideBounds) buildingIdsByDistrict.get(district.id).add(building.id);
    });
  });
  const buildingCountByDistrict = new Map(
    [...buildingIdsByDistrict.entries()].map(([districtId, buildingIds]) => [districtId, buildingIds.size])
  );
  const radius = Number(root.userData?.surfaceNavigation?.radius ?? 220);
  const context = {
    state,
    worldState: world.stateWorld ?? state.world ?? {},
    grid,
    gridCells,
    cellsByCoord,
    buildings: [],
    buildingsByCellId: new Map(),
    unindexedBuildings: [],
    buildingCandidates: [],
    buildingQueryVersion: 0,
    districts,
    buildingCountByDistrict,
    blockSelections: new Map(),
    planetCenter: new THREE.Vector3(0, -radius, 0),
    radius
  };
  context.buildings = placements.map((placement, order) => {
    const object = buildingObjectsById.get(placement.buildingId) ?? null;
    const building = state.buildings?.[placement.buildingId] ?? null;
    if (!object && !building) return null;
    const footprintCellIds = placement.footprintCells ?? building?.footprintCells ?? [];
    const geometry = getBuildingGeometry({ placement, object, building }, context);
    const entry = {
      placement,
      object,
      building,
      footprintCellIds,
      footprintCellIdSet: new Set(footprintCellIds),
      boundsWorld: geometry.boundsWorld,
      anchorWorld: geometry.anchorWorld,
      order,
      cityInfoQueryVersion: -1
    };
    if (footprintCellIds.length === 0) context.unindexedBuildings.push(entry);
    footprintCellIds.forEach((cellId) => {
      let entries = context.buildingsByCellId.get(cellId);
      if (!entries) {
        entries = [];
        context.buildingsByCellId.set(cellId, entries);
      }
      entries.push(entry);
    });
    return entry;
  }).filter(Boolean);
  return context;
}

function resolveSelection(context, camera, viewMode) {
  const surface = camera.userData?.districtSurface;
  if (!surface) return null;
  const centralCell = cellAtFlatPoint(context, surface.flatX, surface.flatZ);
  if (!centralCell) return null;

  if (viewMode === "near") {
    const building = selectCityInfoBuilding(context, centralCell, camera);
    if (!building) return null;
    const buildingId = building.placement.buildingId;
    return {
      key: "building:" + buildingId,
      kind: "building",
      kicker: "BUILDING · " + statusLabel(building.building),
      title: building.building?.program?.name ?? building.placement.label ?? buildingId,
      subtitle: buildingSubtitle(building.building),
      anchorWorld: building.anchorWorld,
      targetWorld: building.anchorWorld,
      detailTarget: {
        kind: "building",
        id: buildingId,
        building: building.building
      }
    };
  }

  const block = selectCityInfoBlock(context, centralCell.cell, camera, surface);
  if (!block) return null;
  let selection = context.blockSelections.get(block.id);
  if (!selection) {
    const buildingCount = context.buildingCountByDistrict.get(block.id) ?? 0;
    selection = {
      key: "block:" + block.id,
      kind: "block",
      kicker: blockKicker(block, context),
      title: block.name ?? block.id,
      subtitle: blockSubtitle(block, buildingCount),
      anchorWorld: getBlockAnchor(block, context),
      targetWorld: getBlockTarget(block, context),
      targetNormal: getBlockTargetNormal(block, context),
      ...getBlockBoundary(block, context),
      detailTarget: {
        kind: "block",
        id: block.id,
        district: block
      }
    };
    context.blockSelections.set(block.id, selection);
  }
  return selection;
}

export function selectCityInfoBlock(context, cell, camera, surface = {}) {
  const candidates = context.districts
    .filter((district) => district.status !== "cancelled")
    .map((district) => {
      const projection = projectToScreen(getBlockAnchor(district, context), camera, { width: 2, height: 2 });
      return {
        district,
        containsCenter: isCellWithinBlock(cell, district.bounds),
        screenDistance: projection.visible
          ? Math.hypot(projection.ndcX, projection.ndcY)
          : Number.POSITIVE_INFINITY,
        flatDistance: distanceToBlock(surface.flatX, surface.flatZ, district, context),
        area: blockArea(district.bounds)
      };
    })
    .filter((candidate) => candidate.containsCenter
      || candidate.screenDistance <= BLOCK_SELECTION_RADIUS_NDC);
  candidates.sort((left, right) => {
    if (left.containsCenter !== right.containsCenter) return left.containsCenter ? -1 : 1;
    if (left.containsCenter) return left.area - right.area || left.screenDistance - right.screenDistance;
    return left.screenDistance - right.screenDistance
      || left.flatDistance - right.flatDistance
      || left.area - right.area;
  });
  return candidates[0]?.district ?? null;
}

export function selectCityInfoBuilding(context, centralCell, camera) {
  const candidates = collectNearbyBuildings(context, centralCell);
  const centerCellId = centralCell.cell.id;
  let selected = null;
  let selectedIncludesCenter = false;
  let selectedScreenDistance = Number.POSITIVE_INFINITY;

  for (const entry of candidates) {
    const includesCenter = entry.footprintCellIdSet.has(centerCellId);
    const projection = projectToScreen(entry.anchorWorld, camera, { width: 2, height: 2 });
    const screenDistance = projection.visible
      ? Math.hypot(projection.ndcX, projection.ndcY)
      : Number.POSITIVE_INFINITY;
    if (!includesCenter && screenDistance > SELECTION_RADIUS_NDC) continue;
    const isBetter = !selected
      || (includesCenter && !selectedIncludesCenter)
      || (includesCenter === selectedIncludesCenter && screenDistance < selectedScreenDistance)
      || (includesCenter === selectedIncludesCenter
        && screenDistance === selectedScreenDistance
        && entry.order < selected.order);
    if (!isBetter) continue;
    selected = entry;
    selectedIncludesCenter = includesCenter;
    selectedScreenDistance = screenDistance;
  }
  return selected;
}

function collectNearbyBuildings(context, centralCell) {
  const candidates = context.buildingCandidates;
  candidates.length = 0;
  context.buildingQueryVersion += 1;
  const queryVersion = context.buildingQueryVersion;
  const centerColumn = Number(centralCell.cell.column);
  const centerRow = Number(centralCell.cell.row);

  for (let rowOffset = -BUILDING_SEARCH_CELL_RADIUS; rowOffset <= BUILDING_SEARCH_CELL_RADIUS; rowOffset += 1) {
    for (let columnOffset = -BUILDING_SEARCH_CELL_RADIUS; columnOffset <= BUILDING_SEARCH_CELL_RADIUS; columnOffset += 1) {
      const cell = context.cellsByCoord.get(`${centerColumn + columnOffset}:${centerRow + rowOffset}`);
      if (!cell) continue;
      appendBuildingCandidates(context.buildingsByCellId.get(cell.id), candidates, queryVersion);
    }
  }
  appendBuildingCandidates(context.unindexedBuildings, candidates, queryVersion);
  return candidates;
}

function appendBuildingCandidates(entries, candidates, queryVersion) {
  if (!entries) return;
  for (const entry of entries) {
    if (entry.cityInfoQueryVersion === queryVersion) continue;
    entry.cityInfoQueryVersion = queryVersion;
    candidates.push(entry);
  }
}

function cellAtFlatPoint(context, flatX, flatZ) {
  const columns = Number(context.grid.columns ?? 0);
  const rows = Number(context.grid.rows ?? 0);
  const cellWorldSize = Number(context.grid.cellWorldSize ?? 4);
  if (!columns || !rows) return null;
  const column = Math.floor((Number(flatX) + columns * cellWorldSize / 2) / cellWorldSize);
  const row = Math.floor((rows * cellWorldSize / 2 - Number(flatZ)) / cellWorldSize);
  if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
  const cell = context.cellsByCoord.get(`${column}:${row}`)
    ?? context.state.cells?.["cell-" + column + "-" + row];
  if (!cell) return null;
  return {
    cell,
    flatX: cellCenter(cell, columns, rows, cellWorldSize).x,
    flatZ: cellCenter(cell, columns, rows, cellWorldSize).z
  };
}

function getBlockCenter(block, context) {
  const bounds = getBlockWorldBounds(block, context);
  return {
    x: (bounds.minX + bounds.maxX) * 0.5,
    z: (bounds.minZ + bounds.maxZ) * 0.5
  };
}

function getBlockAnchor(block, context) {
  const center = getBlockCenter(block, context);
  const frame = getVoxelSphereFrame(center.x, center.z, context.radius);
  return frame.surface.clone().addScaledVector(frame.normal, 1.5);
}

function getBlockTarget(block, context) {
  const center = getBlockCenter(block, context);
  return getSurfacePoint(center.x, center.z, context, 0.24);
}

function getBlockTargetNormal(block, context) {
  const center = getBlockCenter(block, context);
  return getVoxelSphereFrame(center.x, center.z, context.radius).normal;
}

function getBlockBoundary(block, context) {
  const cellWorldSize = Number(context.grid.cellWorldSize ?? 4);
  const inset = Math.min(0.18, cellWorldSize * 0.06);
  const bounds = getBlockWorldBounds(block, context);
  const minX = bounds.minX + inset;
  const maxX = bounds.maxX - inset;
  const minZ = bounds.minZ + inset;
  const maxZ = bounds.maxZ - inset;
  return {
    boundaryEdges: [
      sampleBlockEdge(minX, minZ, maxX, minZ, context),
      sampleBlockEdge(maxX, minZ, maxX, maxZ, context),
      sampleBlockEdge(maxX, maxZ, minX, maxZ, context),
      sampleBlockEdge(minX, maxZ, minX, minZ, context)
    ]
  };
}

function sampleBlockEdge(startX, startZ, endX, endZ, context) {
  const cellWorldSize = Number(context.grid.cellWorldSize ?? 4);
  const length = Math.hypot(endX - startX, endZ - startZ);
  const sampleCount = Math.max(2, Math.ceil(length / Math.max(0.8, cellWorldSize * 0.45)) + 1);
  return Array.from({ length: sampleCount }, (_, index) => {
    const amount = index / (sampleCount - 1);
    return getSurfacePoint(
      startX + (endX - startX) * amount,
      startZ + (endZ - startZ) * amount,
      context,
      0.14
    );
  });
}

function getSurfacePoint(x, z, context, offset) {
  const frame = getVoxelSphereFrame(x, z, context.radius);
  const terrainHeight = getSurfaceHeight(x, z, context);
  return frame.surface.clone().addScaledVector(frame.normal, terrainHeight + offset);
}

function getSurfaceHeight(x, z, context) {
  const epsilon = 0.0001;
  const clampedX = clamp(x, -context.grid.columns * context.grid.cellWorldSize / 2 + epsilon, context.grid.columns * context.grid.cellWorldSize / 2 - epsilon);
  const clampedZ = clamp(z, -context.grid.rows * context.grid.cellWorldSize / 2 + epsilon, context.grid.rows * context.grid.cellWorldSize / 2 - epsilon);
  const cell = cellAtFlatPoint(context, clampedX, clampedZ)?.cell;
  const constructionDatum = Number(
    context.state.constructionDatum?.finishedConstructionHeightWorld
      ?? context.worldState?.constructionDatum?.finishedConstructionHeightWorld
      ?? -0.0625
  );
  const voxelSize = Number(
    context.state.constructionDatum?.voxelSize
      ?? context.worldState?.constructionDatum?.voxelSize
      ?? 0.125
  );
  const elevation = Number(cell?.surface?.maxElevationVoxels ?? 0);
  return Math.max(constructionDatum, constructionDatum + elevation * voxelSize);
}

function getBlockWorldBounds(block, context) {
  const columns = Number(context.grid.columns ?? 0);
  const rows = Number(context.grid.rows ?? 0);
  const cellWorldSize = Number(context.grid.cellWorldSize ?? 4);
  const bounds = block.bounds ?? {};
  return {
    minX: -columns * cellWorldSize / 2 + Number(bounds.minColumn) * cellWorldSize,
    maxX: -columns * cellWorldSize / 2 + (Number(bounds.maxColumn) + 1) * cellWorldSize,
    minZ: rows * cellWorldSize / 2 - (Number(bounds.maxRow) + 1) * cellWorldSize,
    maxZ: rows * cellWorldSize / 2 - Number(bounds.minRow) * cellWorldSize
  };
}

function distanceToBlock(x, z, block, context) {
  const bounds = getBlockWorldBounds(block, context);
  const dx = Math.max(bounds.minX - Number(x), 0, Number(x) - bounds.maxX);
  const dz = Math.max(bounds.minZ - Number(z), 0, Number(z) - bounds.maxZ);
  return Math.hypot(dx, dz);
}

function isCellWithinBlock(cell, bounds = {}) {
  return Number(cell.column) >= Number(bounds.minColumn)
    && Number(cell.column) <= Number(bounds.maxColumn)
    && Number(cell.row) >= Number(bounds.minRow)
    && Number(cell.row) <= Number(bounds.maxRow);
}

function blockArea(bounds = {}) {
  return (Number(bounds.maxColumn) - Number(bounds.minColumn) + 1)
    * (Number(bounds.maxRow) - Number(bounds.minRow) + 1);
}

function blockKicker(block) {
  const bounds = block.bounds ?? {};
  const width = Number(bounds.maxColumn) - Number(bounds.minColumn) + 1;
  const depth = Number(bounds.maxRow) - Number(bounds.minRow) + 1;
  return `BLOCK · ${width} × ${depth}`;
}

function blockSubtitle(block, buildingCount) {
  const countLabel = `${buildingCount} building${buildingCount === 1 ? "" : "s"}`;
  const purpose = String(block.purpose ?? "planned area").replace(/\s+quarter$/i, "");
  return `${countLabel} · ${purpose}`;
}

function getBuildingGeometry(entry, context) {
  if (entry.object) {
    const bounds = new THREE.Box3().setFromObject(entry.object);
    if (!bounds.isEmpty()) {
      return {
        boundsWorld: bounds,
        anchorWorld: new THREE.Vector3(
          (bounds.min.x + bounds.max.x) * 0.5,
          bounds.max.y + 0.42,
          (bounds.min.z + bounds.max.z) * 0.5
        )
      };
    }
  }
  const footprint = entry.placement.footprintCells ?? entry.building?.footprintCells ?? [];
  const centers = footprint.map((id) => {
    const cell = context.state.cells?.[id];
    return cell ? cellCenter(cell, context.grid.columns, context.grid.rows, context.grid.cellWorldSize) : null;
  }).filter(Boolean);
  const center = centers.reduce((sum, point) => ({
    x: sum.x + point.x / Math.max(1, centers.length),
    z: sum.z + point.z / Math.max(1, centers.length)
  }), { x: 0, z: 0 });
  const frame = getVoxelSphereFrame(center.x, center.z, context.radius);
  return {
    boundsWorld: null,
    anchorWorld: frame.surface.clone().addScaledVector(frame.normal, 5.4)
  };
}

function cellCenter(cell, columns, rows, cellWorldSize) {
  return {
    x: Number(cell.center?.x ?? (Number(cell.column) + 0.5 - columns / 2) * cellWorldSize),
    z: Number(cell.center?.z ?? (rows / 2 - Number(cell.row) - 0.5) * cellWorldSize)
  };
}

function projectToScreen(worldPoint, camera, viewport) {
  cameraPointScratch.copy(worldPoint).applyMatrix4(camera.matrixWorldInverse);
  if (cameraPointScratch.z >= 0) return { visible: false, ndcX: 0, ndcY: 0 };
  ndcPointScratch.copy(worldPoint).project(camera);
  return {
    visible: ndcPointScratch.z >= -1 && ndcPointScratch.z <= 1,
    ndcX: ndcPointScratch.x,
    ndcY: ndcPointScratch.y,
    x: (ndcPointScratch.x * 0.5 + 0.5) * viewport.width,
    y: (-ndcPointScratch.y * 0.5 + 0.5) * viewport.height
  };
}

function getDepthScale(worldPoint, camera) {
  cameraPointScratch.copy(worldPoint).applyMatrix4(camera.matrixWorldInverse);
  const depth = Math.max(1, -cameraPointScratch.z);
  const referenceDepth = 58;
  return clamp(Math.pow(referenceDepth / depth, 0.72), MIN_CARD_SCALE, MAX_CARD_SCALE);
}

function buildingSubtitle(building) {
  if (!building) return "Building";
  const purpose = PURPOSE_LABELS[building.program?.purpose] ?? building.program?.purpose ?? "Building";
  const status = STATUS_LABELS[building.status] ?? building.status ?? "Active";
  return purpose + " · " + status;
}

function statusLabel(building) {
  return STATUS_LABELS[building?.status] ?? "ACTIVE";
}

function findBuildingObjects(root) {
  const buildingsById = new Map();
  if (!root) return buildingsById;
  root.traverse((object) => {
    const buildingId = object.userData?.buildingId;
    if (buildingId && !buildingsById.has(buildingId)) buildingsById.set(buildingId, object);
  });
  return buildingsById;
}

function approach(current, target, delta, rate) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, delta) * rate));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
