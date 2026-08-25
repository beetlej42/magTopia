import assert from "node:assert/strict";
import test from "node:test";
import { INCIDENT_DEFINITIONS, incidentAttribute, incidentDefinition } from "../src/gameplay/incidents.js";
import { INCIDENT_TYPES, normalizeExposureIncident } from "../src/gameplay/schema.js";

test("exactly three structured incident types exist", () => {
  assert.deepEqual(INCIDENT_TYPES, ["investigation", "suppression", "cover_up"]);
  for (const type of INCIDENT_TYPES) {
    assert.ok(INCIDENT_DEFINITIONS[type], `definition for ${type}`);
    assert.equal(INCIDENT_DEFINITIONS[type].attribute, type === "cover_up" ? "coverUp" : type);
  }
});

test("each incident definition maps to the matching arcane officer attribute", () => {
  assert.equal(incidentAttribute("investigation"), "investigation");
  assert.equal(incidentAttribute("suppression"), "suppression");
  assert.equal(incidentAttribute("cover_up"), "coverUp");
  assert.equal(incidentAttribute("unknown_type"), "investigation", "unknown types fall back to investigation");
  assert.equal(incidentDefinition("suppression").label, "suppression");
});

test("incidents normalize with a stable attribute and summary", () => {
  const incident = normalizeExposureIncident({
    id: "incident-1",
    buildingId: "building-1",
    type: "cover_up",
    dc: 14,
    severity: 3,
    summary: INCIDENT_DEFINITIONS.cover_up.summaryTemplate("The Old Theater"),
    status: "open",
    createdAtTurn: 1
  });
  assert.equal(incident.attribute, "coverUp");
  assert.equal(incident.status, "open");
  assert.match(incident.summary, /Old Theater/);
  assert.equal(incident.dc, 14);
  const unresolved = normalizeExposureIncident({ id: "incident-2", buildingId: "building-2", type: "investigation", difficulty: 3, severity: 2 });
  assert.equal(unresolved.attribute, "investigation");
  assert.equal(unresolved.status, "open");
});

test("unknown incident status is rejected", () => {
  assert.throws(() => normalizeExposureIncident({ id: "x", buildingId: "b", type: "investigation", status: "bogus" }), /Unsupported incident status/);
});
