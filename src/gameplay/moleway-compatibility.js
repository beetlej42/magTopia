import { SPECIAL_STRUCTURES } from "./card-catalog.js";

// Preserve the old card/building identities and placement entitlements. Only
// the live building label changes; historical events remain an audit record.
export function upgradeMolewayNames(state) {
  const cardId = "floo-fireplace-station";
  const name = SPECIAL_STRUCTURES[cardId].name;
  let buildings;
  for (const [id, building] of Object.entries(state?.buildings ?? {})) {
    if (building.specialStructure?.cardId !== cardId || building.program?.name === name) continue;
    buildings ??= { ...state.buildings };
    buildings[id] = { ...building, program: { ...building.program, name } };
  }
  return buildings ? { ...state, buildings } : state;
}
