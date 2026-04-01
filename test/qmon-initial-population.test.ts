import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonGenomeService } from "../src/qmon/qmon-genome.service.ts";

test("QmonGenomeService builds a deterministic taker-only bootstrap population", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const uniqueGenomes = new Set(initialPopulation.map((genome) => JSON.stringify(genome)));
  const enabledTriggerCounts = initialPopulation.map((genome) => genome.triggerGenes.filter((triggerGene) => triggerGene.isEnabled).length);
  const thresholdPairs = new Set(initialPopulation.map((genome) => `${genome.minScoreBuy}/${genome.minScoreSell}`));
  assert.equal(initialPopulation.length, 100);
  assert.equal(uniqueGenomes.size, 100);
  assert.equal(
    initialPopulation.every((genome) => genome.maxTradesPerWindow >= 1),
    true,
  );
  assert.equal(
    initialPopulation.every((genome) => genome.maxTradesPerWindow <= config.MAX_MAX_TRADES_PER_WINDOW),
    true,
  );
  assert.equal(
    initialPopulation.every((genome) => genome.maxSlippageBps >= 25),
    true,
  );
  assert.equal(
    initialPopulation.every((genome) => genome.maxSlippageBps <= config.MAX_MAX_SLIPPAGE_BPS),
    true,
  );
  assert.equal(
    initialPopulation.every((genome) => genome.takeProfitPct === 0.5),
    true,
  );
  assert.equal(
    enabledTriggerCounts.every((enabledTriggerCount) => enabledTriggerCount <= 2),
    true,
  );
  assert.equal(new Set(initialPopulation.map((genome) => genome.timeWindowGenes.join(""))).size >= 4, true);
  assert.equal(new Set(initialPopulation.map((genome) => genome.directionRegimeGenes.join(""))).size >= 4, true);
  assert.equal(new Set(initialPopulation.map((genome) => genome.volatilityRegimeGenes.join(""))).size >= 4, true);
  assert.equal(new Set(initialPopulation.map((genome) => genome.maxSlippageBps)).size >= 10, true);
  assert.equal(thresholdPairs.size >= 4, true);
});

test("QmonGenomeService seeded genomes remain valid public presets", () => {
  const genomeService = QmonGenomeService.createDefault();
  const seededGenomes = [
    genomeService.generateSeededGenome("consensus"),
    genomeService.generateSeededGenome("momentum"),
    genomeService.generateSeededGenome("balanced"),
  ];

  assert.equal(
    seededGenomes.every((genome) => genomeService.validateGenome(genome)),
    true,
  );

  const balancedGenome = seededGenomes[2];
  const meanReversionGene = balancedGenome?.predictiveSignalGenes.find((signalGene) => signalGene.signalId === "meanReversion");
  assert.equal(meanReversionGene?.orientation, "inverse");
});

test("QmonGenomeService keeps score thresholds independent from edge thresholds", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const hasIndependentThresholds = initialPopulation.some(
    (genome) =>
      Number((genome.entryPolicy.minEdgeBps / 100).toFixed(2)) !== genome.minScoreBuy ||
      Number((genome.entryPolicy.minEdgeBps / 100).toFixed(2)) !== genome.minScoreSell,
  );
  const allThresholdsAreMeaningful = initialPopulation.every((genome) => genome.minScoreBuy >= 0.3 && genome.minScoreSell >= 0.3);

  assert.equal(hasIndependentThresholds, true);
  assert.equal(allThresholdsAreMeaningful, true);
});
