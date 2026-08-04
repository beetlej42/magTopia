import { normalizeConstructionProposal } from "./contracts.js";
import { findCandidateParcels, previewConstruction } from "./solver.js";
import { createEngineContext, executeCityCommand } from "./engine.js";

export function createCityWorkbench(initialState) {
  let state = initialState;
  const context = createEngineContext();
  return {
    getState: () => structuredClone(state),
    findCandidateParcels: (criteria) => findCandidateParcels(state, criteria),
    previewConstruction: (input) => previewConstruction(state, normalizeConstructionProposal(input, context)),
    submitConstruction(input) {
      const proposal = normalizeConstructionProposal(input, context);
      const result = executeCityCommand(state, { type: "construct_building", proposal }, context);
      if (result.accepted) state = result.state;
      return result;
    },
    connectRoad({ fromBuildingId, toBuildingId, actor = "agent:unknown" } = {}) {
      const from = state.buildings[fromBuildingId];
      const to = state.buildings[toBuildingId];
      if (!from || !to) return { accepted: false, errors: ["Both fromBuildingId and toBuildingId must reference existing buildings"] };
      if (fromBuildingId === toBuildingId) return { accepted: false, errors: ["fromBuildingId and toBuildingId must reference different buildings"] };
      return this.connect({
        from: { kind: "building", id: fromBuildingId },
        to: { kind: "building", id: toBuildingId },
        mode: "road",
        actor
      });
    },
    connect(connection) {
      const result = executeCityCommand(state, { type: "connect", ...connection }, context);
      if (result.accepted) state = result.state;
      return result;
    },
    advanceTime({ hours = 24, actor = "system:clock" } = {}) {
      const result = executeCityCommand(state, { type: "advance_time", hours, actor }, context);
      if (result.accepted) state = result.state;
      return result;
    }
  };
}
