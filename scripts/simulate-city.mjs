#!/usr/bin/env node

import { runCitySimulation, normalizeStrategy, normalizeTurns } from "../src/gameplay/city-simulator.js";

function parseArgs(argv) {
  const values = { turns: 20, strategy: "balanced", seed: "city-simulation-001", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      values.json = true;
      continue;
    }
    const match = /^--(turns|strategy|seed)=(.*)$/.exec(argument);
    if (match) {
      values[match[1]] = match[2];
      continue;
    }
    if (argument === "--turns" || argument === "--strategy" || argument === "--seed") {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      values.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run simulate:city -- --turns 20 --strategy balanced --seed demo [--json]");
    process.exit(0);
  }
  const report = runCitySimulation({
    turns: normalizeTurns(args.turns),
    strategy: normalizeStrategy(args.strategy),
    seed: args.seed
  });
  if (args.json) {
    console.log(JSON.stringify(report));
  } else {
    const summary = report.summary;
    console.log(`City simulation: ${report.strategy}, ${report.turnsRequested} turns, seed=${report.seed}`);
    console.log(`Buildings: ${summary.cumulativeConstruction.buildings}; construction spend: ${summary.cumulativeConstruction.coins} coins`);
    console.log(`Roads: ${summary.cumulativeRoad.cells} cells; road spend: ${summary.cumulativeRoad.coins} coins`);
    console.log(`Final resources: ${summary.final.coins} coins, ${summary.final.arcaneEnergy} AE`);
    console.log(`Population: ${summary.final.population.muggles.current + summary.final.population.wizards.current}/${summary.final.population.muggles.capacity + summary.final.population.wizards.capacity}`);
    console.log(`Longest stall: ${summary.continuousStallTurns} turns; sustainable=${summary.sustainable}; anomalies=${summary.anomalies.length}`);
  }
} catch (error) {
  console.error(`simulate:city: ${error.message}`);
  process.exitCode = 2;
}
