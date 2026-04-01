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
  },
): Qmon {
  return {
    id: options.id,
    market: MARKET_KEY,
    genome,
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
