import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonGenomeService } from "../src/qmon/qmon-genome.service.ts";
import type { QmonGenome } from "../src/qmon/qmon.types.ts";

function getBeliefSignature(genome: QmonGenome): string {
  const beliefSignature = Object.entries(genome.beliefWeights)
    .map(([beliefKey, beliefWeight]) => `${beliefKey}:${beliefWeight}`)
    .join("|");

  return beliefSignature;
}

test("QmonGenomeService builds a deterministic settlement-focused bootstrap population", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const uniqueGenomes = new Set(initialPopulation.map((genome) => JSON.stringify(genome)));
  const confidenceThresholds = new Set(initialPopulation.map((genome) => genome.entryPolicy.confidenceThreshold));
  const riskBudgets = new Set(initialPopulation.map((genome) => genome.riskBudgetUsd));

  assert.equal(initialPopulation.length, 200);
  assert.equal(uniqueGenomes.size, 200);
  assert.equal(initialPopulation.every((genome) => genome.executionPolicy.maxTradesPerWindow >= 1), true);
  assert.equal(initialPopulation.every((genome) => genome.executionPolicy.maxTradesPerWindow <= config.MAX_MAX_TRADES_PER_WINDOW), true);
  assert.equal(initialPopulation.every((genome) => genome.entryPolicy.maxSlippageBps >= 25), true);
  assert.equal(initialPopulation.every((genome) => genome.entryPolicy.maxSlippageBps <= config.QMON_MAX_ENTRY_SLIPPAGE_BPS), true);
  assert.equal(initialPopulation.every((genome) => genome.exitPolicy.thesisCollapseProbability >= 0.25), true);
  assert.equal(initialPopulation.every((genome) => genome.exitPolicy.extremeDrawdownPct <= 0.95), true);
  assert.equal(initialPopulation.every((genome) => genome.riskBudgetUsd >= 1.05), true);
  assert.equal(confidenceThresholds.size >= 5, true);
  assert.equal(riskBudgets.size >= 5, true);
});

test("QmonGenomeService seeded genomes remain valid settlement presets", () => {
  const genomeService = QmonGenomeService.createDefault();
  const seededGenomes = [
    genomeService.generateSeededGenome("consensus"),
    genomeService.generateSeededGenome("momentum"),
    genomeService.generateSeededGenome("balanced"),
  ];

  assert.equal(seededGenomes.every((genome) => genomeService.validateGenome(genome)), true);
  assert.equal((seededGenomes[0]?.beliefWeights.consensusPersistence ?? 0) > 1, true);
  assert.equal((seededGenomes[1]?.beliefWeights.resolutionMomentum ?? 0) > 1, true);
  assert.equal((seededGenomes[2]?.beliefWeights.marketDivergence ?? 0) > 1, true);
});

test("QmonGenomeService initial population preserves multiple settlement archetypes", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const consensusResolvers = initialPopulation.filter((genome) => genome.beliefWeights.consensusPersistence >= 1);
  const trendConfirmers = initialPopulation.filter((genome) => genome.beliefWeights.resolutionMomentum >= 1.1);
  const divergenceHunters = initialPopulation.filter((genome) => genome.beliefWeights.marketDivergence >= 1.2);
  const skepticalBooks = initialPopulation.filter((genome) => genome.beliefWeights.bookFreshness >= 1.1);

  assert.equal(consensusResolvers.length >= 20, true);
  assert.equal(trendConfirmers.length >= 20, true);
  assert.equal(divergenceHunters.length >= 20, true);
  assert.equal(skepticalBooks.length >= 20, true);
});

test("QmonGenomeService initial population keeps meaningful variability across belief profiles", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const sizeTiers = new Set(initialPopulation.map((genome) => genome.executionPolicy.sizeTier));
  const cooldownProfiles = new Set(initialPopulation.map((genome) => genome.executionPolicy.cooldownProfile));
  const fillQualityLevels = new Set(initialPopulation.map((genome) => genome.entryPolicy.minFillQuality));
  const uncertaintyTolerances = new Set(initialPopulation.map((genome) => genome.entryPolicy.uncertaintyTolerance));
  const beliefSignatures = new Set(initialPopulation.map((genome) => getBeliefSignature(genome)));

  assert.equal(sizeTiers.size >= 3, true);
  assert.equal(cooldownProfiles.has("balanced"), true);
  assert.equal(cooldownProfiles.has("patient"), true);
  assert.equal(fillQualityLevels.size >= 4, true);
  assert.equal(uncertaintyTolerances.size >= 4, true);
  assert.equal(beliefSignatures.size >= 30, true);
});
