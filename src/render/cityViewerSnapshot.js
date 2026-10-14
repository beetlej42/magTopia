// City versions include economy, cards and report workflow. Only scene inputs
// should invalidate geometry; keep this list aligned with agentAcceptanceCity.
export function getCityViewerSceneKey(state = {}, assets = []) {
  return stableJson({
    mapId: state.mapId,
    mapSeed: state.mapSeed,
    world: state.world,
    cells: state.cells,
    buildings: state.buildings,
    infrastructure: state.infrastructure,
    nodes: state.nodes,
    districts: state.districts,
    reservations: state.reservations,
    // Population updates refresh the street-life layer independently.
    assets
  });
}

function stableJson(value) {
  return JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]));
  });
}

export function reuseCityBakedArtifacts(manifest, previousManifest, artifacts) {
  const previous = new Map(previousManifest.map((entry) => [entry.buildingId, artifactKey(entry)]));
  return Object.fromEntries(manifest
    .filter((entry) => artifacts[entry.buildingId] && previous.get(entry.buildingId) === artifactKey(entry))
    .map((entry) => [entry.buildingId, artifacts[entry.buildingId]]));
}

function artifactKey(entry) {
  return JSON.stringify([entry.cityId, entry.designRevision, entry.artifactVersion, String(entry.sha256).toLowerCase()]);
}
