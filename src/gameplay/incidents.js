export const INCIDENT_DEFINITIONS = Object.freeze({
  investigation: Object.freeze({
    attribute: "investigation",
    difficultyBase: 2,
    label: "investigation",
    specialty: "investigation",
    summaryTemplate: (name) => `Unresolved magical anomaly reported near ${name}; origin requires investigation.`
  }),
  containment: Object.freeze({
    attribute: "containment",
    difficultyBase: 2,
    label: "containment",
    specialty: "containment",
    summaryTemplate: (name) => `Uncontrolled magical activity detected at ${name}; requires containment.`
  }),
  concealment: Object.freeze({
    attribute: "concealment",
    difficultyBase: 2,
    label: "concealment",
    specialty: "concealment",
    summaryTemplate: (name) => `Ordinary citizens noticed unusual events around ${name}; needs concealment work.`
  })
});

export function incidentDefinition(type) {
  return INCIDENT_DEFINITIONS[type] ?? INCIDENT_DEFINITIONS.investigation;
}

export function incidentAttribute(type) {
  return incidentDefinition(type).attribute;
}
