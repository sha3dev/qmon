import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonGenomeService } from "../src/qmon/qmon-genome.service.ts";
import type { QmonGenome } from "../src/qmon/qmon.types.ts";

function getEnabledTriggerKey(genome: QmonGenome): string {
  const enabledTriggerIds = genome.triggerGenes
    .filter((triggerGene) => triggerGene.isEnabled)
    .map((triggerGene) => triggerGene.triggerId)
    .sort();
  const enabledTriggerKey = enabledTriggerIds.join("|");

  return enabledTriggerKey;
}

function hasPredictiveSignal(genome: QmonGenome, signalId: string, orientation: "aligned" | "inverse"): boolean {
  const hasMatchingSignal = genome.predictiveSignalGenes.some(
    (signalGene) => signalGene.signalId === signalId && signalGene.orientation === orientation,
  );

  return hasMatchingSignal;
}

function hasMicrostructureSignal(genome: QmonGenome, signalId: string, orientation: "aligned" | "inverse"): boolean {
  const hasMatchingSignal = genome.microstructureSignalGenes.some(
    (signalGene) => signalGene.signalId === signalId && signalGene.orientation === orientation,
  );

  return hasMatchingSignal;
}

test("QmonGenomeService builds a deterministic taker-only bootstrap population", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const uniqueGenomes = new Set(initialPopulation.map((genome) => JSON.stringify(genome)));
  const enabledTriggerCounts = initialPopulation.map((genome) => genome.triggerGenes.filter((triggerGene) => triggerGene.isEnabled).length);
  const thresholdPairs = new Set(initialPopulation.map((genome) => `${genome.minScoreBuy}/${genome.minScoreSell}`));
  assert.equal(initialPopulation.length, 200);
  assert.equal(uniqueGenomes.size, 200);
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

test("QmonGenomeService initial population preserves coherent strategic families", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const families = new Map<string, QmonGenome[]>();

  for (const genome of initialPopulation) {
    const familyKey = getEnabledTriggerKey(genome);
    const familyGenomes = families.get(familyKey) ?? [];
    familyGenomes.push(genome);
    families.set(familyKey, familyGenomes);
  }

  const momentumFamily = families.get("momentum-shift|strong-momentum") ?? [];
  const reversionFamily = families.get("mispricing|reversion-extreme") ?? [];
  const orderBookFamily = families.get("book-pressure|liquidity-shift") ?? [];
  const lateWindowFamily = families.get("extreme-distance|time-decay") ?? [];
  const crossAssetFamily = families.get("consensus-flip|strong-momentum") ?? [];
  const liquidityVacuumFamily = families.get("liquidity-shift|reversion-extreme") ?? [];
  const micropriceScalperFamily = families.get("book-pressure|strong-imbalance") ?? [];
  const breakoutFamily = families.get("acceleration-spike|breakout") ?? [];
  const efficiencyFamily = families.get("efficiency-anomaly|mispricing") ?? [];
  const timeDecayFamily = families.get("consensus-flip|time-decay") ?? [];

  assert.equal(momentumFamily.length >= 16, true);
  assert.equal(reversionFamily.length >= 16, true);
  assert.equal(orderBookFamily.length >= 16, true);
  assert.equal(lateWindowFamily.length >= 16, true);
  assert.equal(crossAssetFamily.length >= 16, true);
  assert.equal(liquidityVacuumFamily.length >= 16, true);
  assert.equal(micropriceScalperFamily.length >= 16, true);
  assert.equal(breakoutFamily.length >= 16, true);
  assert.equal(efficiencyFamily.length >= 16, true);
  assert.equal(timeDecayFamily.length >= 16, true);

  assert.equal(
    momentumFamily.every(
      (genome) =>
        hasPredictiveSignal(genome, "momentum", "aligned") &&
        hasPredictiveSignal(genome, "velocity", "aligned") &&
        genome.executionPolicy.maxTradesPerWindow >= 2 &&
        genome.executionPolicy.cooldownProfile !== "patient",
    ),
    true,
  );
  assert.equal(
    reversionFamily.every(
      (genome) =>
        hasPredictiveSignal(genome, "distance", "inverse") &&
        hasPredictiveSignal(genome, "meanReversion", "inverse") &&
        genome.executionPolicy.maxTradesPerWindow === 1 &&
        genome.executionPolicy.cooldownProfile === "patient",
    ),
    true,
  );
  assert.equal(
    orderBookFamily.every(
      (genome) =>
        hasMicrostructureSignal(genome, "imbalance", "aligned") &&
        hasMicrostructureSignal(genome, "microprice", "aligned") &&
        hasMicrostructureSignal(genome, "bookDepth", "aligned") &&
        genome.entryPolicy.minConfirmations === 3,
    ),
    true,
  );
  assert.equal(
    lateWindowFamily.every(
      (genome) =>
        hasPredictiveSignal(genome, "distance", "aligned") &&
        hasMicrostructureSignal(genome, "spread", "inverse") &&
        genome.timeWindowGenes[0] === false &&
        genome.executionPolicy.cooldownProfile === "patient" &&
        genome.entryPolicy.minEdgeBps >= 40,
    ),
    true,
  );
  assert.equal(
    crossAssetFamily.every(
      (genome) =>
        hasPredictiveSignal(genome, "crossAssetMomentum", "aligned") &&
        hasPredictiveSignal(genome, "momentum", "aligned") &&
        genome.executionPolicy.maxTradesPerWindow >= 2,
    ),
    true,
  );
  assert.equal(
    micropriceScalperFamily.every(
      (genome) =>
        hasMicrostructureSignal(genome, "microprice", "aligned") &&
        hasMicrostructureSignal(genome, "imbalance", "aligned") &&
        genome.entryPolicy.minConfirmations === 3,
    ),
    true,
  );
});

test("QmonGenomeService initial population keeps meaningful variability across coherent families", () => {
  const genomeService = QmonGenomeService.createDefault();
  const initialPopulation = genomeService.generateInitialPopulation();
  const sizeTiers = new Set(initialPopulation.map((genome) => genome.executionPolicy.sizeTier));
  const cooldownProfiles = new Set(initialPopulation.map((genome) => genome.executionPolicy.cooldownProfile));
  const fillQualityLevels = new Set(initialPopulation.map((genome) => genome.entryPolicy.minFillQuality));
  const scorePairs = new Set(initialPopulation.map((genome) => `${genome.minScoreBuy}/${genome.minScoreSell}`));
  const triggerPairs = new Set(initialPopulation.map((genome) => getEnabledTriggerKey(genome)));
  const predictiveCombos = new Set(
    initialPopulation.map((genome) =>
      genome.predictiveSignalGenes
        .map((signalGene) => `${signalGene.signalId}:${signalGene.orientation}:${signalGene.weightTier}`)
        .sort()
        .join(","),
    ),
  );
  const microstructureCombos = new Set(
    initialPopulation.map((genome) =>
      genome.microstructureSignalGenes
        .map((signalGene) => `${signalGene.signalId}:${signalGene.orientation}:${signalGene.weightTier}`)
        .sort()
        .join(","),
    ),
  );

  assert.equal(sizeTiers.size >= 3, true);
  assert.equal(cooldownProfiles.has("tight"), true);
  assert.equal(cooldownProfiles.has("balanced"), true);
  assert.equal(cooldownProfiles.has("patient"), true);
  assert.equal(fillQualityLevels.size >= 5, true);
  assert.equal(scorePairs.size >= 5, true);
  assert.equal(triggerPairs.size >= 20, true);
  assert.equal(predictiveCombos.size >= 30, true);
  assert.equal(microstructureCombos.size >= 30, true);
});
