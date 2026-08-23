import {
  ECONOMY_RULES,
  capacitiesFromCanonicalUnits,
  incomeForCanonicalBuildings,
  migratePopulationBucket,
  supportedPopulationTargets
} from "./economy.js";

// A deliberately small, dependency-free Phase 2 harness. It models the
// no-service baseline directly through the same pure settlement functions as
// resolveTurn, making 10/20-turn balance checks reproducible in CI or a REPL.
export function runNoServiceScenario(turns = 12, options = {}) {
  const count = Math.max(1, Math.min(50, Math.trunc(Number(turns) || 12)));
  const metadata = {
    verticalResidence: {
      canonical: true,
      status: "completed",
      units: [{ purpose: "residential", area: 2, magicRatio: 0.5 }]
    },
    market: {
      canonical: true,
      status: "completed",
      units: [{ purpose: "commercial", area: 1, magicRatio: 0.5 }]
    },
    works: {
      canonical: true,
      status: "completed",
      units: [{ purpose: "production", area: 1, magicRatio: 0 }]
    },
    greenhouse: {
      canonical: true,
      status: "completed",
      units: [{ purpose: "greenhouse", area: 1, magicRatio: 1 }]
    }
  };
  const capacities = capacitiesFromCanonicalUnits(metadata.verticalResidence.units);
  const target = supportedPopulationTargets(capacities, options);
  let population = { muggles: { current: 0, capacity: capacities.muggles }, wizards: { current: 0, capacity: capacities.wizards } };
  let resources = { coins: ECONOMY_RULES.initialCoins, arcaneEnergy: ECONOMY_RULES.initialArcaneEnergy };
  const turnsResult = [];
  for (let turn = 1; turn <= count; turn += 1) {
    // Income intentionally sees start-of-turn residents; migration follows.
    const income = incomeForCanonicalBuildings(metadata, population, options);
    resources = { coins: resources.coins + income.coins, arcaneEnergy: resources.arcaneEnergy + income.arcaneEnergy };
    population = {
      muggles: { ...migratePopulationBucket(population.muggles, target.muggles, options.muggleMigrationRate ?? options.migrationRate), capacity: capacities.muggles },
      wizards: { ...migratePopulationBucket(population.wizards, target.wizards, options.wizardMigrationRate ?? options.migrationRate), capacity: capacities.wizards }
    };
    turnsResult.push({ turn, resources: { ...resources }, population: structuredClone(population), income: { ...income } });
  }
  return { rules: ECONOMY_RULES, metadata, capacities, target, turns: turnsResult, final: turnsResult.at(-1) };
}
