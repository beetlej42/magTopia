export const INCIDENT_DEFINITIONS = Object.freeze({
  investigation: Object.freeze({
    attribute: "investigation",
    specialty: "investigation",
    label: "investigation",
    summaryTemplate: (name) => `Unresolved magical anomaly reported near ${name}; origin requires investigation.`
  }),
  suppression: Object.freeze({
    attribute: "suppression",
    specialty: "suppression",
    label: "suppression",
    summaryTemplate: (name) => `Uncontrolled magical activity detected at ${name}; requires suppression.`
  }),
  cover_up: Object.freeze({
    attribute: "coverUp",
    specialty: "cover_up",
    label: "cover_up",
    summaryTemplate: (name) => `Muggles noticed unusual events around ${name}; requires a cover-up.`
  })
});

export function incidentDefinition(type) {
  return INCIDENT_DEFINITIONS[type] ?? INCIDENT_DEFINITIONS.investigation;
}

export function incidentAttribute(type) {
  return incidentDefinition(type).attribute;
}

export function incidentSummary(type, buildingName) {
  return incidentDefinition(type).summaryTemplate(String(buildingName ?? "a building"));
}
