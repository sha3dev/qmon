import * as assert from "node:assert/strict";
import { test } from "node:test";

import { QmonEvolutionService } from "../src/qmon/qmon-evolution.service.ts";
import { QmonGenomeService } from "../src/qmon/qmon-genome.service.ts";
import type { MarketKey, Qmon, QmonPopulation } from "../src/qmon/qmon.types.ts";

const MARKET_KEY = "btc-5m" as const satisfies MarketKey;

function createEmptyPosition(): Qmon["position"] {
  return {
    action: null,
    enteredAt: null,
    entryScore: null,
    entryPrice: null,
    peakReturnPct: null,
    shareCount: null,
    priceToBeat: null,
    marketStartMs: null,
    marketEndMs: null,
  };
}

function createQmon(
  genome: Qmon["genome"],
  options: {
    id: string;
    totalPnl: number;
    championScore: number | null;
    paperLongWindowPnlSum: number;
    negativeWindowRateLast10: number;
    windowsLived: number;
    totalTrades: number;
    paperWindowPnls: readonly number[];
    strategyKind?: Qmon["strategyKind"];
    strategyName?: string;
    strategyDescription?: string;
    presetStrategyId?: string | null;
    presetFamily?: string | null;
  },
): Qmon {
  return {
    id: options.id,
    market: MARKET_KEY,
    genome,
    strategyKind: options.strategyKind ?? "genetic",
    strategyName: options.strategyName ?? "Genetic Test Strategy",
    strategyDescription: options.strategyDescription ?? "Synthetic QMON used by evolution tests.",
    presetStrategyId: options.presetStrategyId ?? null,
    presetFamily: options.presetFamily ?? null,
    role: "candidate",
    lifecycle: "active",
    generation: 0,
    parentIds: [],
    createdAt: 1,
    position: createEmptyPosition(),
    pendingOrder: null,
    metrics: {
      totalTrades: options.totalTrades,
      totalPnl: options.totalPnl,
      championScore: options.championScore,
      fitnessScore: options.championScore,
      paperWindowMedianPnl: 0.5,
      paperWindowPnlSum: options.paperWindowPnls.reduce((sum, value) => sum + value, 0),
      paperLongWindowPnlSum: options.paperLongWindowPnlSum,
      negativeWindowRateLast10: options.negativeWindowRateLast10,
      worstWindowPnlLast10: -0.2,
      recentAvgSlippageBps: 10,
      isChampionEligible: options.championScore !== null,
      championEligibilityReasons: options.championScore === null ? ["insufficient-windows"] : [],
      totalFeesPaid: 0.2,
      winRate: 0.6,
      winCount: 6,
      avgScore: 0.55,
      maxDrawdown: 0.1,
      grossAlphaCapture: 5,
      netPnlPerTrade: options.totalTrades > 0 ? options.totalPnl / options.totalTrades : 0,
      feeRatio: options.championScore === null ? 0.8 : 0.2,
      slippageRatio: 0.1,
      noTradeDisciplineScore: 0.7,
      regimeBreakdown: [
        { regime: "regime:flat|normal", tradeCount: options.totalTrades, totalPnl: options.totalPnl, estimatedNetEvUsd: options.paperLongWindowPnlSum },
      ],
      triggerBreakdown: [
        { triggerId: "consensus-flip", tradeCount: options.totalTrades, totalPnl: options.totalPnl, estimatedNetEvUsd: options.paperLongWindowPnlSum },
      ],
      totalEstimatedNetEvUsd: options.paperLongWindowPnlSum,
      lastUpdate: 1,
    },
    decisionHistory: [],
    windowTradeCount: 0,
    windowsLived: options.windowsLived,
    paperWindowPnls: options.paperWindowPnls,
    paperWindowSlippageBps: [10, 12],
    paperWindowBaselinePnl: null,
    currentWindowStart: 700,
    currentWindowSlippageTotalBps: 0,
    currentWindowSlippageFillCount: 0,
    lastCloseTimestamp: null,
  };
}

function createPopulation(qmons: readonly Qmon[]): QmonPopulation {
  return {
    market: MARKET_KEY,
    qmons,
    createdAt: 1,
    lastUpdated: 1,
    activeChampionQmonId: "CHAMP01",
    marketPaperSessionPnl: 0,
    marketConsolidatedPnl: 0,
    seatPosition: createEmptyPosition(),
    seatPendingOrder: null,
    seatLastCloseTimestamp: null,
    seatLastWindowStartMs: 777,
    seatLastSettledWindowStartMs: null,
  };
}

function withMockRandom<T>(run: () => T): T {
  const originalRandom = Math.random;
  let cursor = 0;

  Math.random = () => {
    cursor += 1;
    return ((cursor % 89) + 1) / 100;
  };

  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

test("QmonEvolutionService replaces weak QMONs using the strongest taker-only parents", () => {
  const genomeService = QmonGenomeService.createDefault();
  const evolutionService = new QmonEvolutionService(genomeService);
  const seededGenome = genomeService.generateSeededGenome("balanced");
  const strongQmons = [
    createQmon(seededGenome, {
      id: "CHAMP01",
      totalPnl: 12,
      championScore: 320,
      paperLongWindowPnlSum: 9,
      negativeWindowRateLast10: 0,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.8),
    }),
    createQmon(seededGenome, {
      id: "PARENT02",
      totalPnl: 11,
      championScore: 300,
      paperLongWindowPnlSum: 8.5,
      negativeWindowRateLast10: 0,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.75),
    }),
    createQmon(seededGenome, {
      id: "PARENT03",
      totalPnl: 10,
      championScore: 290,
      paperLongWindowPnlSum: 8.2,
      negativeWindowRateLast10: 0,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.7),
    }),
    createQmon(seededGenome, {
      id: "PARENT04",
      totalPnl: 9.8,
      championScore: 280,
      paperLongWindowPnlSum: 7.9,
      negativeWindowRateLast10: 0.1,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.68),
    }),
    createQmon(seededGenome, {
      id: "PARENT05",
      totalPnl: 9.4,
      championScore: 270,
      paperLongWindowPnlSum: 7.4,
      negativeWindowRateLast10: 0.1,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.66),
    }),
    createQmon(seededGenome, {
      id: "PARENT06",
      totalPnl: 9.1,
      championScore: 260,
      paperLongWindowPnlSum: 7.1,
      negativeWindowRateLast10: 0.1,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.64),
    }),
    createQmon(seededGenome, {
      id: "PARENT07",
      totalPnl: 8.9,
      championScore: 250,
      paperLongWindowPnlSum: 6.9,
      negativeWindowRateLast10: 0.1,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.62),
    }),
    createQmon(seededGenome, {
      id: "PARENT08",
      totalPnl: 8.7,
      championScore: 240,
      paperLongWindowPnlSum: 6.7,
      negativeWindowRateLast10: 0.1,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.6),
    }),
    createQmon(seededGenome, {
      id: "PARENT09",
      totalPnl: 8.4,
      championScore: 230,
      paperLongWindowPnlSum: 6.5,
      negativeWindowRateLast10: 0.1,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.58),
    }),
    createQmon(seededGenome, {
      id: "PARENT10",
      totalPnl: 8.1,
      championScore: 220,
      paperLongWindowPnlSum: 6.2,
      negativeWindowRateLast10: 0.2,
      windowsLived: 12,
      totalTrades: 14,
      paperWindowPnls: Array(10).fill(0.56),
    }),
  ];
  const weakQmons = [
    createQmon(seededGenome, {
      id: "WEAK01",
      totalPnl: -6,
      championScore: null,
      paperLongWindowPnlSum: -4,
      negativeWindowRateLast10: 0.8,
      windowsLived: 10,
      totalTrades: 4,
      paperWindowPnls: Array(10).fill(-0.3),
    }),
    createQmon(seededGenome, {
      id: "WEAK02",
      totalPnl: -5,
      championScore: null,
      paperLongWindowPnlSum: -3.5,
      negativeWindowRateLast10: 0.7,
      windowsLived: 10,
      totalTrades: 4,
      paperWindowPnls: Array(10).fill(-0.25),
    }),
  ];
  const originalIds = new Set([...strongQmons, ...weakQmons].map((qmon) => qmon.id));

  const evolutionResult = withMockRandom(() =>
    evolutionService.evolvePopulation(createPopulation([...strongQmons, ...weakQmons]), (newbornQmon, currentWindowStartMs) => ({
      ...newbornQmon,
      currentWindowStart: currentWindowStartMs,
    })),
  );
  const newbornQmons = evolutionResult.population.qmons.filter((qmon) => !originalIds.has(qmon.id));

  assert.equal(evolutionResult.replacements.length, 1);
  assert.equal(evolutionResult.population.qmons.length, 12);
  assert.equal(
    evolutionResult.replacements.every((replacement) => replacement.deadQmonId === "WEAK01" || replacement.deadQmonId === "WEAK02"),
    true,
  );
  assert.equal(newbornQmons.length, 1);
  assert.equal(
    newbornQmons.every((qmon) => qmon.generation === 1),
    true,
  );
  assert.equal(
    newbornQmons.every((qmon) => qmon.currentWindowStart === 777),
    true,
  );
  assert.equal(
    evolutionResult.population.qmons.some((qmon) => qmon.id === "CHAMP01"),
    true,
  );
  assert.equal(evolutionResult.highestChildGeneration, 1);
});

test("QmonEvolutionService never uses preset QMONs as parents and never replaces them", () => {
  const genomeService = QmonGenomeService.createDefault();
  const evolutionService = new QmonEvolutionService(genomeService);
  const seededGenome = genomeService.generateSeededGenome("balanced");
  const presetChampion = createQmon(seededGenome, {
    id: "PRESET01",
    totalPnl: 15,
    championScore: 500,
    paperLongWindowPnlSum: 12,
    negativeWindowRateLast10: 0,
    windowsLived: 20,
    totalTrades: 40,
    paperWindowPnls: Array(20).fill(1),
    strategyKind: "preset",
    strategyName: "Preset Control",
    strategyDescription: "Preset strategy that must stay immutable in evolution.",
    presetStrategyId: "late-threshold-sprint-01",
    presetFamily: "late-threshold-sprint",
  });
  const weakPreset = createQmon(seededGenome, {
    id: "PRESET02",
    totalPnl: -10,
    championScore: null,
    paperLongWindowPnlSum: -9,
    negativeWindowRateLast10: 1,
    windowsLived: 20,
    totalTrades: 40,
    paperWindowPnls: Array(20).fill(-0.5),
    strategyKind: "preset",
    strategyName: "Preset Loser",
    strategyDescription: "Preset strategy that must not be replaced by evolution.",
    presetStrategyId: "late-threshold-sprint-02",
    presetFamily: "late-threshold-sprint",
  });
  const geneticParent = createQmon(seededGenome, {
    id: "GEN01",
    totalPnl: 11,
    championScore: 320,
    paperLongWindowPnlSum: 8,
    negativeWindowRateLast10: 0,
    windowsLived: 20,
    totalTrades: 20,
    paperWindowPnls: Array(20).fill(0.8),
  });
  const secondGeneticParent = createQmon(seededGenome, {
    id: "GEN03",
    totalPnl: 10,
    championScore: 300,
    paperLongWindowPnlSum: 7,
    negativeWindowRateLast10: 0,
    windowsLived: 20,
    totalTrades: 20,
    paperWindowPnls: Array(20).fill(0.7),
  });
  const weakGenetic = createQmon(seededGenome, {
    id: "GEN02",
    totalPnl: -6,
    championScore: null,
    paperLongWindowPnlSum: -4,
    negativeWindowRateLast10: 0.8,
    windowsLived: 20,
    totalTrades: 4,
    paperWindowPnls: Array(20).fill(-0.3),
  });
  const evolutionResult = withMockRandom(() =>
    evolutionService.evolvePopulation(
      createPopulation([presetChampion, weakPreset, geneticParent, secondGeneticParent, weakGenetic]),
      (newbornQmon) => newbornQmon,
    ),
  );

  assert.equal(evolutionResult.replacements.length, 1);
  assert.equal(
    evolutionResult.replacements.every((replacement) => replacement.deadQmonId !== "PRESET01" && replacement.deadQmonId !== "PRESET02"),
    true,
  );
  assert.equal(
    evolutionResult.replacements.every((replacement) => !replacement.parentIds.includes("PRESET01") && !replacement.parentIds.includes("PRESET02")),
    true,
  );
  assert.equal(
    evolutionResult.population.qmons.filter((qmon) => qmon.id === "PRESET01" || qmon.id === "PRESET02").length,
    2,
  );
});

test("QmonEvolutionService biases offspring trigger and regime genes toward profitable parent breakdowns", () => {
  const genomeService = QmonGenomeService.createDefault();
  const evolutionService = new QmonEvolutionService(genomeService);
  const parentGenome = {
    ...genomeService.generateSeededGenome("balanced"),
    triggerGenes: genomeService.generateSeededGenome("balanced").triggerGenes.map((triggerGene) => ({
      ...triggerGene,
      isEnabled: triggerGene.triggerId === "consensus-flip",
    })),
    directionRegimeGenes: [true, true, true] as const,
    volatilityRegimeGenes: [true, true, true] as const,
  };
  const firstParent = createQmon(parentGenome, {
    id: "PARENT_A",
    totalPnl: 9,
    championScore: 200,
    paperLongWindowPnlSum: 6,
    negativeWindowRateLast10: 0,
    windowsLived: 12,
    totalTrades: 14,
    paperWindowPnls: Array(10).fill(0.6),
  });
  const secondParent = createQmon(parentGenome, {
    id: "PARENT_B",
    totalPnl: 8,
    championScore: 190,
    paperLongWindowPnlSum: 5,
    negativeWindowRateLast10: 0,
    windowsLived: 12,
    totalTrades: 14,
    paperWindowPnls: Array(10).fill(0.5),
  });
  const guidedFirstParent = {
    ...firstParent,
    metrics: {
      ...firstParent.metrics,
      regimeBreakdown: [{ regime: "regime:flat|normal", tradeCount: 12, totalPnl: 7, estimatedNetEvUsd: 5 }],
      triggerBreakdown: [{ triggerId: "mispricing", tradeCount: 12, totalPnl: 7, estimatedNetEvUsd: 5 }],
    },
  };
  const guidedSecondParent = {
    ...secondParent,
    metrics: {
      ...secondParent.metrics,
      regimeBreakdown: [{ regime: "regime:flat|normal", tradeCount: 11, totalPnl: 6, estimatedNetEvUsd: 4 }],
      triggerBreakdown: [{ triggerId: "mispricing", tradeCount: 11, totalPnl: 6, estimatedNetEvUsd: 4 }],
    },
  };
  const weakQmon = createQmon(parentGenome, {
    id: "WEAK_GUIDE",
    totalPnl: -5,
    championScore: null,
    paperLongWindowPnlSum: -3,
    negativeWindowRateLast10: 0.9,
    windowsLived: 12,
    totalTrades: 4,
    paperWindowPnls: Array(10).fill(-0.2),
  });

  const evolutionResult = withMockRandom(() =>
    evolutionService.evolvePopulation(createPopulation([guidedFirstParent, guidedSecondParent, weakQmon]), (newbornQmon) => newbornQmon),
  );
  const childQmon = evolutionResult.population.qmons.find((qmon) => qmon.id !== "PARENT_A" && qmon.id !== "PARENT_B");

  assert.ok(childQmon);
  assert.equal(childQmon.genome.triggerGenes.some((triggerGene) => triggerGene.triggerId === "mispricing" && triggerGene.isEnabled), true);
  assert.deepEqual(childQmon.genome.directionRegimeGenes, [false, false, true]);
  assert.deepEqual(childQmon.genome.volatilityRegimeGenes, [false, true, false]);
});
