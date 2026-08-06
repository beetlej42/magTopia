import * as THREE from "three";
import { getVoxelSphereFrame } from "../generators/voxelIntentDistrict.js";

const CARD_BASE_WIDTH = 198;
const CARD_BASE_HEIGHT = 70;
const CARD_GAP_PX = 22;
const MIN_CARD_SCALE = 0.78;
const MAX_CARD_SCALE = 1.16;
const SELECTION_DELAY_MS = 125;
const SELECTION_RADIUS_NDC = 0.28;

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

  const leader = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leader.classList.add("city-info-leader");
  leader.setAttribute("aria-hidden", "true");

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.classList.add("city-info-leader-line");
  const targetHalo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  targetHalo.classList.add("city-info-target-halo");
  targetHalo.setAttribute("r", "11");
  const targetDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  targetDot.classList.add("city-info-target-dot");
  targetDot.setAttribute("r", "4");
  leader.append(line, targetHalo, targetDot);

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
    active: null,
    pendingKey: null,
    pendingSince: 0,
    opacity: 0,
    detailTarget: null
  };

  card.addEventListener("click", () => {
    if (!state.active) return;
    overlay.dispatchEvent(new CustomEvent("city-info:open-detail", {
      detail: structuredClone(state.detailTarget ?? state.active)
    }));
  });

  function setSceneRoot(root = null) {
    state.root = root;
    state.active = null;
    state.pendingKey = null;
    state.pendingSince = 0;
    state.detailTarget = null;
    state.opacity = 0;
    overlay.classList.toggle("is-enabled", Boolean(root));
    overlay.setAttribute("aria-hidden", root ? "false" : "true");
  }

  function update({ camera, delta = 0.016, viewMode = "far", viewport }) {
    const root = state.root;
    if (!root || !camera || !viewport?.width || !viewport?.height) {
      state.opacity = approach(state.opacity, 0, delta, 14);
      applyOpacity();
      return;
    }

    const context = createContext(root);
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
          updateCardContent(selection);
          card.classList.toggle("is-parcel", selection.kind === "parcel");
          card.classList.toggle("is-building", selection.kind === "building");
        }
      }
    }

    const shouldShow = Boolean(state.active && selection && state.active.key === selection.key);
    state.opacity = approach(state.opacity, shouldShow ? 1 : 0, delta, shouldShow ? 13 : 16);

    if (state.active) {
      const screen = projectToScreen(state.active.anchorWorld, camera, viewport);
      if (!screen.visible) {
        state.opacity = approach(state.opacity, 0, delta, 16);
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
        line.setAttribute("x2", String(screen.x));
        line.setAttribute("y2", String(screen.y));
        targetHalo.setAttribute("cx", String(screen.x));
        targetHalo.setAttribute("cy", String(screen.y));
        targetDot.setAttribute("cx", String(screen.x));
        targetDot.setAttribute("cy", String(screen.y));
        card.style.setProperty("--card-depth-scale", String(scale));
      }
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

function createContext(root) {
  const state = root.userData?.cityState ?? {};
  const world = root.userData?.worldContract ?? {};
  const grid = world.grid ?? state.world?.grid ?? {};
  const buildingsRoot = root.getObjectByName("AgentAcceptanceBuildings");
  const placements = buildingsRoot?.userData?.contract?.placements ?? [];
  const buildings = placements.map((placement) => {
    const object = findBuildingObject(buildingsRoot, placement.buildingId);
    const building = state.buildings?.[placement.buildingId] ?? null;
    return { placement, object, building };
  }).filter((entry) => entry.object || entry.building);
  return {
    state,
    grid,
    buildings,
    radius: Number(root.userData?.surfaceNavigation?.radius ?? 220)
  };
}

function resolveSelection(context, camera, viewMode) {
  const surface = camera.userData?.districtSurface;
  if (!surface) return null;
  const centralCell = cellAtFlatPoint(context, surface.flatX, surface.flatZ);
  if (!centralCell) return null;

  if (viewMode === "near") {
    const building = selectBuilding(context, centralCell, camera);
    if (!building) return null;
    const buildingId = building.placement.buildingId;
    return {
      key: "building:" + buildingId,
      kind: "building",
      kicker: "BUILDING · " + statusLabel(building.building),
      title: building.building?.program?.name ?? building.placement.label ?? buildingId,
      subtitle: buildingSubtitle(building.building),
      anchorWorld: getBuildingAnchor(building, context),
      detailTarget: {
        kind: "building",
        id: buildingId,
        building: building.building
      }
    };
  }

  const cell = centralCell.cell;
  const building = cell.occupancy ? context.state.buildings?.[cell.occupancy] : null;
  return {
    key: "parcel:" + cell.id,
    kind: "parcel",
    kicker: "PARCEL",
    title: parcelTitle(cell),
    subtitle: parcelSubtitle(cell, building),
    anchorWorld: getParcelAnchor(centralCell, context),
    detailTarget: {
      kind: "parcel",
      id: cell.id,
      cell
    }
  };
}

function selectBuilding(context, centralCell, camera) {
  const candidates = context.buildings.map((entry) => {
    const footprint = entry.placement.footprintCells ?? entry.building?.footprintCells ?? [];
    const includesCenter = footprint.includes(centralCell.cell.id);
    const anchorWorld = getBuildingAnchor(entry, context);
    const projection = projectToScreen(anchorWorld, camera, { width: 2, height: 2 });
    const screenDistance = projection.visible
      ? Math.hypot(projection.ndcX, projection.ndcY)
      : Number.POSITIVE_INFINITY;
    return {
      ...entry,
      includesCenter,
      screenDistance
    };
  }).filter((entry) => entry.screenDistance <= SELECTION_RADIUS_NDC || entry.includesCenter);

  candidates.sort((left, right) => {
    if (left.includesCenter !== right.includesCenter) return left.includesCenter ? -1 : 1;
    return left.screenDistance - right.screenDistance;
  });
  return candidates[0] ?? null;
}

function cellAtFlatPoint(context, flatX, flatZ) {
  const columns = Number(context.grid.columns ?? 0);
  const rows = Number(context.grid.rows ?? 0);
  const cellWorldSize = Number(context.grid.cellWorldSize ?? 4);
  if (!columns || !rows) return null;
  const column = Math.floor((Number(flatX) + columns * cellWorldSize / 2) / cellWorldSize);
  const row = Math.floor((rows * cellWorldSize / 2 - Number(flatZ)) / cellWorldSize);
  if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
  const cells = context.grid.cells ?? Object.values(context.state.cells ?? {});
  const cell = cells.find((candidate) => Number(candidate.column) === column && Number(candidate.row) === row)
    ?? context.state.cells?.["cell-" + column + "-" + row];
  if (!cell) return null;
  return {
    cell,
    flatX: cellCenter(cell, columns, rows, cellWorldSize).x,
    flatZ: cellCenter(cell, columns, rows, cellWorldSize).z
  };
}

function getParcelAnchor(selectedCell, context) {
  const frame = getVoxelSphereFrame(selectedCell.flatX, selectedCell.flatZ, context.radius);
  return frame.surface.clone().addScaledVector(frame.normal, 0.9);
}

function getBuildingAnchor(entry, context) {
  if (entry.object) {
    const bounds = new THREE.Box3().setFromObject(entry.object);
    if (!bounds.isEmpty()) {
      return new THREE.Vector3(
        (bounds.min.x + bounds.max.x) * 0.5,
        bounds.max.y + 0.42,
        (bounds.min.z + bounds.max.z) * 0.5
      );
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
  return frame.surface.clone().addScaledVector(frame.normal, 5.4);
}

function cellCenter(cell, columns, rows, cellWorldSize) {
  return {
    x: Number(cell.center?.x ?? (Number(cell.column) + 0.5 - columns / 2) * cellWorldSize),
    z: Number(cell.center?.z ?? (rows / 2 - Number(cell.row) - 0.5) * cellWorldSize)
  };
}

function projectToScreen(worldPoint, camera, viewport) {
  const cameraPoint = worldPoint.clone().applyMatrix4(camera.matrixWorldInverse);
  if (cameraPoint.z >= 0) return { visible: false, ndcX: 0, ndcY: 0 };
  const ndc = worldPoint.clone().project(camera);
  return {
    visible: ndc.z >= -1 && ndc.z <= 1,
    ndcX: ndc.x,
    ndcY: ndc.y,
    x: (ndc.x * 0.5 + 0.5) * viewport.width,
    y: (-ndc.y * 0.5 + 0.5) * viewport.height
  };
}

function getDepthScale(worldPoint, camera) {
  const cameraPoint = worldPoint.clone().applyMatrix4(camera.matrixWorldInverse);
  const depth = Math.max(1, -cameraPoint.z);
  const referenceDepth = 58;
  return clamp(Math.pow(referenceDepth / depth, 0.72), MIN_CARD_SCALE, MAX_CARD_SCALE);
}

function buildingSubtitle(building) {
  if (!building) return "Building";
  const purpose = PURPOSE_LABELS[building.program?.purpose] ?? building.program?.purpose ?? "Building";
  const status = STATUS_LABELS[building.status] ?? building.status ?? "Active";
  return purpose + " · " + status;
}

function parcelTitle(cell) {
  const label = cell.name ?? cell.label;
  return label ?? "Parcel " + (Number(cell.column) + 1) + " · " + (Number(cell.row) + 1);
}

function parcelSubtitle(cell, building) {
  if (building) return "Occupied · " + (building.program?.name ?? "Building");
  if (cell.infrastructure === "road") return "Road frontage";
  if (cell.buildable === false) return "Waterfront";
  if (cell.reservation) return "Reserved";
  return "Available for construction";
}

function statusLabel(building) {
  return STATUS_LABELS[building?.status] ?? "ACTIVE";
}

function findBuildingObject(root, buildingId) {
  if (!root || !buildingId) return null;
  let match = null;
  root.traverse((object) => {
    if (!match && object.userData?.buildingId === buildingId) match = object;
  });
  return match;
}

function approach(current, target, delta, rate) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, delta) * rate));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
