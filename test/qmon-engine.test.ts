import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonChampionService } from "../src/qmon/qmon-champion.service.ts";
import { QmonEngine } from "../src/qmon/qmon-engine.service.ts";
import { QmonPresetStrategyService } from "../src/qmon/qmon-preset-strategy.service.ts";
import type { DirectionRegimeValue, MarketKey, Qmon, QmonFamilyState, QmonPopulation, VolatilityRegimeValue } from "../src/qmon/qmon.types.ts";
import type { RegimeResult } from "../src/regime/regime.types.ts";
import { SignalEngine } from "../src/signal/signal-engine.service.ts";
import type { Snapshot, StructuredSignalResult } from "../src/signal/signal.types.ts";

const MARKET_KEY = "btc-5m" as const satisfies MarketKey;

function mustValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected value");
  }

  return value;
}

function createRegimes(
  direction: DirectionRegimeValue = "flat",
  volatility: VolatilityRegimeValue = "normal",
): RegimeResult {
  return {
    btc: {
      direction,
      volatility,
      directionStrength: 0,
      volatilityLevel: 0,
      lastUpdated: 1,
    },
  };
}

function createSignals(
  signalValue: number,
  upPrice: number,
  downPrice: number,
  marketStartMs: number,
  marketEndMs: number,
  chainlinkPrice = 100_000,
  edge = 0.2,
  distance = 0.2,
): StructuredSignalResult {
  return {
    btc: {
      chainlinkPrice,
      signals: {
        velocity: { "30s": signalValue, "2m": null, "5m": null },
        momentum: { "30s": signalValue, "2m": signalValue, "5m": null },
        meanReversion: { "30s": null, "2m": null, "5m": null },
        oracleLag: signalValue,
        dispersion: 0,
        imbalance: signalValue,
        microprice: 0,
        staleness: 0,
        acceleration: 0,
        volatilityRegime: 0,
        spread: 0,
        bookDepth: 0,
        crossAssetMomentum: 0,
      },
      windows: {
        "5m": {
          signals: {
            distance,
            zScore: 0,
            edge,
            tokenPressure: 0,
            marketEfficiency: 0,
          },
          prices: {
            priceToBeat: 100_000,
            upPrice,
            downPrice,
            marketStartMs,
            marketEndMs,
          },
        },
      },
    },
  };
}

function createSnapshot(upPrice: number, downPrice: number, upSize = 50, downSize = 50): Snapshot {
  return {
    generated_at: 1,
    btc_5m_up_order_book_json: JSON.stringify({
      bids: [{ price: upPrice, size: upSize }],
      asks: [{ price: upPrice, size: upSize }],
    }),
    btc_5m_down_order_book_json: JSON.stringify({
      bids: [{ price: downPrice, size: downSize }],
      asks: [{ price: downPrice, size: downSize }],
    }),
  } as Snapshot;
}

function createQmon(role: "candidate" | "champion" = "candidate"): Qmon {
  return {
    id: "QMON01",
    market: MARKET_KEY,
    genome: {
      predictiveSignalGenes: [{ signalId: "edge", orientation: "aligned", weightTier: 3 }],
      microstructureSignalGenes: [{ signalId: "imbalance", orientation: "aligned", weightTier: 2 }],
      signalGenes: [
        { signalId: "edge", weights: { _default: 3 } },
        { signalId: "imbalance", weights: { _default: 2 } },
      ],
      triggerGenes: [{ triggerId: "consensus-flip", isEnabled: true }],
      timeWindowGenes: [true, true, true],
      directionRegimeGenes: [true, true, true],
      volatilityRegimeGenes: [true, true, true],
      exchangeWeights: [0.25, 0.25, 0.25, 0.25],
      entryPolicy: {
        minEdgeBps: 10,
        minNetEvUsd: 0.01,
        minConfirmations: 1,
        maxSpreadPenaltyBps: 100,
        maxSlippageBps: 1_500,
        minFillQuality: 0.2,
      },
      executionPolicy: {
        sizeTier: 2,
        maxTradesPerWindow: 2,
        cooldownProfile: "tight",
      },
      exitPolicy: {
        extremeStopLossPct: 0.3,
        extremeTakeProfitPct: 0.5,
        thesisInvalidationPolicy: "hybrid",
      },
      maxTradesPerWindow: 2,
      maxSlippageBps: 1_500,
      minScoreBuy: 0.7,
      minScoreSell: 0.7,
      stopLossPct: 0.3,
      takeProfitPct: 0.5,
    },
    role,
    lifecycle: "active",
    generation: 0,
    parentIds: [],
    createdAt: 1,
    position: {
      action: null,
      enteredAt: null,
      entryScore: null,
      entryPrice: null,
      peakReturnPct: null,
      shareCount: null,
      priceToBeat: null,
      marketStartMs: null,
      marketEndMs: null,
    },
    pendingOrder: null,
    metrics: {
      totalTrades: 0,
      totalPnl: 0,
      championScore: null,
      paperWindowMedianPnl: null,
      paperWindowPnlSum: 0,
      paperLongWindowPnlSum: 0,
      negativeWindowRateLast10: 0,
      worstWindowPnlLast10: null,
      recentAvgSlippageBps: 0,
      isChampionEligible: false,
      championEligibilityReasons: [],
      totalFeesPaid: 0,
      winRate: 0,
      winCount: 0,
      avgScore: 0,
      maxDrawdown: 0,
      lastUpdate: 1,
    },
    decisionHistory: [],
    windowTradeCount: 0,
    windowsLived: 0,
    paperWindowPnls: [],
    paperWindowSlippageBps: [],
    paperWindowBaselinePnl: null,
    currentWindowStart: null,
    currentWindowSlippageTotalBps: 0,
    currentWindowSlippageFillCount: 0,
    lastCloseTimestamp: null,
  };
}

function createPresetQmon(): Qmon {
  const presetStrategyService = QmonPresetStrategyService.createDefault();
  const presetStrategyDefinition = presetStrategyService.getPresetStrategyDefinition("edge-distance-confluence-01");

  if (presetStrategyDefinition === null) {
    throw new Error("expected preset strategy definition");
  }

  return {
    ...createQmon(),
    id: "PRESET01",
    strategyKind: "preset",
    strategyName: presetStrategyDefinition.strategyName,
    strategyDescription: presetStrategyDefinition.strategyDescription,
    presetStrategyId: presetStrategyDefinition.presetStrategyId,
    presetFamily: presetStrategyDefinition.presetFamily,
    genome: presetStrategyService.createCompatibilityGenome(presetStrategyDefinition),
  };
}

function createPopulation(qmons: readonly Qmon[], activeChampionQmonId: string | null = null): QmonPopulation {
  return {
    market: MARKET_KEY,
    qmons,
    createdAt: 1,
    lastUpdated: 1,
    activeChampionQmonId,
    marketPaperSessionPnl: 0,
    marketConsolidatedPnl: 0,
    seatPosition: {
      action: null,
      enteredAt: null,
      entryScore: null,
      entryPrice: null,
      peakReturnPct: null,
      shareCount: null,
      priceToBeat: null,
      marketStartMs: null,
      marketEndMs: null,
    },
    seatPendingOrder: null,
    seatLastCloseTimestamp: null,
    seatLastWindowStartMs: null,
    seatLastSettledWindowStartMs: null,
  };
}

function createFamilyState(population: QmonPopulation): QmonFamilyState {
  return {
    populations: [population],
    globalGeneration: 0,
    createdAt: 1,
    lastUpdated: 1,
  };
}

function withMockNow<T>(mockNow: number, run: () => T): T {
  const originalDateNow = Date.now;

  Date.now = () => mockNow;

  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

test("QmonEngine initializes one deterministic taker-only population per market", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], undefined, undefined, undefined, undefined, false, false);

  qmonEngine.initializePopulations();

  const population = mustValue(qmonEngine.getPopulation(MARKET_KEY));
  const expectedPresetCount = config.QMON_PRESET_QMONS_ENABLED ? config.QMON_PRESET_QMON_COUNT : 0;
  const expectedPopulationSize = config.QMON_GENETIC_POPULATION_SIZE + expectedPresetCount;

  assert.equal(population.qmons.length, expectedPopulationSize);
  assert.equal(population.qmons.filter((qmon) => (qmon.strategyKind ?? "genetic") === "genetic").length, config.QMON_GENETIC_POPULATION_SIZE);
  assert.equal(population.qmons.filter((qmon) => qmon.strategyKind === "preset").length, expectedPresetCount);
  assert.equal(new Set(population.qmons.map((qmon) => JSON.stringify({
    genome: qmon.genome,
    presetStrategyId: qmon.presetStrategyId ?? null,
    strategyKind: qmon.strategyKind ?? "genetic",
  }))).size, expectedPopulationSize);
  assert.equal(
    population.qmons.every((qmon) => qmon.pendingOrder === null),
    true,
  );
});

test("QmonEngine evaluates entry and exit decisions with taker-only cashflow history", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];
  const exitSnapshots = [createSnapshot(0.7, 0.3)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });

  const openedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const entryDecision = mustValue(openedQmon.decisionHistory[0]);

  assert.equal(openedQmon.position.action, "BUY_UP");
  assert.equal(openedQmon.pendingOrder, null);
  assert.equal((entryDecision.modelScore ?? 0) > 0.5, true);
  assert.equal(entryDecision.cashflow < 0, true);
  assert.equal(entryDecision.entryDirectionRegime, "flat");
  assert.equal(entryDecision.entryVolatilityRegime, "normal");
  assert.equal(openedQmon.position.entryDirectionRegime, "flat");
  assert.equal(openedQmon.position.entryVolatilityRegime, "normal");
  assert.equal(Object.hasOwn(entryDecision, "score"), false);

  withMockNow(2_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(-0.9, 0.7, 0.3, marketStartMs, marketEndMs), createRegimes(), [], exitSnapshots);
  });
  withMockNow(4_500, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(-0.9, 0.7, 0.3, marketStartMs, marketEndMs), createRegimes(), [], exitSnapshots);
  });

  const closedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const exitDecision = mustValue(closedQmon.decisionHistory[1]);

  assert.equal(closedQmon.position.action, null);
  assert.equal(closedQmon.metrics.totalTrades, 1);
  assert.equal((exitDecision.modelScore ?? 0) > 0.5, true);
  assert.equal(exitDecision.cashflow > 0, true);
});

test("QmonEngine keeps paper entry pending until the simulated wait elapses", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });

  const waitingQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(waitingQmon.position.action, null);
  assert.notEqual(waitingQmon.pendingOrder, null);
  assert.equal(waitingQmon.decisionHistory.length, 0);

  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });

  const filledQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(filledQmon.position.action, "BUY_UP");
  assert.equal(filledQmon.pendingOrder, null);
  assert.equal(filledQmon.decisionHistory.length, 1);
});

test("QmonEngine tracks exposure ticks and trades-per-window metrics", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });

  const queuedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(queuedQmon.metrics.observedTicks, 1);
  assert.equal(queuedQmon.metrics.positionHoldTicks, 0);
  assert.equal(queuedQmon.metrics.marketExposureRatio, 0);
  assert.equal(queuedQmon.metrics.tradesPerWindow, 0);

  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });
  withMockNow(4_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), [], entrySnapshots);
  });

  const openQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(openQmon.position.action, "BUY_UP");
  assert.equal(openQmon.metrics.observedTicks, 3);
  assert.equal(openQmon.metrics.positionHoldTicks, 1);
  assert.equal(openQmon.metrics.marketExposureRatio, 1 / 3);
  assert.equal(openQmon.metrics.tradesPerWindow, 1);
});

test("QmonEngine uses minimum entry shares when configured to disable EV size scaling", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.3, 0.7)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.3, 0.7, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });

  const waitingQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(waitingQmon.pendingOrder?.requestedShares, 6);
});

test("QmonEngine rejects paper entry when visible book never reaches the full requested size", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 20_000;
  const thinEntrySnapshots = [createSnapshot(0.1, 0.9, 3, 50)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], thinEntrySnapshots);
  });
  withMockNow(5_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], thinEntrySnapshots);
  });

  const stillPendingQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.notEqual(stillPendingQmon.pendingOrder, null);
  assert.equal(stillPendingQmon.position.action, null);

  withMockNow(11_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], thinEntrySnapshots);
  });

  const rejectedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(rejectedQmon.pendingOrder, null);
  assert.equal(rejectedQmon.position.action, null);
  assert.equal(rejectedQmon.decisionHistory.length, 0);
});

test("QmonEngine blocks entries when directional edge and distance contradict the trade", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, -0.2, -0.2),
      createRegimes(),
      ["consensus-flip"],
      snapshots,
    );
  });

  const blockedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(blockedQmon.position.action, null);
  assert.equal(blockedQmon.decisionHistory.length, 0);
});

test("QmonEngine blocks new entries when no enabled trigger fired", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), [], snapshots);
  });

  const blockedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(blockedQmon.position.action, null);
  assert.equal(blockedQmon.pendingOrder, null);
  assert.equal(blockedQmon.decisionHistory.length, 0);
});

test("QmonEngine blocks entries when the current time segment is disabled", () => {
  const timeLockedQmon: Qmon = {
    ...createQmon(),
    genome: {
      ...createQmon().genome,
      timeWindowGenes: [true, false, false],
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([timeLockedQmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(5_500, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const blockedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(blockedQmon.position.action, null);
  assert.equal(blockedQmon.pendingOrder, null);
  assert.equal(blockedQmon.decisionHistory.length, 0);
});

test("QmonEngine blocks entries unless direction and volatility regimes both match", () => {
  const regimeLockedQmon: Qmon = {
    ...createQmon(),
    genome: {
      ...createQmon().genome,
      directionRegimeGenes: [false, false, true],
      volatilityRegimeGenes: [true, false, false],
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([regimeLockedQmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes("flat", "normal"), ["consensus-flip"], snapshots);
  });

  const blockedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(blockedQmon.position.action, null);
  assert.equal(blockedQmon.pendingOrder, null);
  assert.equal(blockedQmon.decisionHistory.length, 0);
});

test("QmonEngine blocks genetic entries when too few valid signals are available", () => {
  const signalLockedQmon: Qmon = {
    ...createQmon(),
    genome: {
      ...createQmon().genome,
      entryPolicy: {
        ...createQmon().genome.entryPolicy,
        minConfirmations: 4,
      },
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([signalLockedQmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const blockedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(blockedQmon.position.action, null);
  assert.equal(blockedQmon.pendingOrder, null);
  assert.equal(blockedQmon.decisionHistory.length, 0);
});

test("QmonEngine allows fixed preset QMONs to open paper positions through the same execution flow", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createPresetQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, 1, 1),
      createRegimes("trending-up", "normal"),
      ["mispricing"],
      entrySnapshots,
    );
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, 1, 1),
      createRegimes("trending-up", "normal"),
      ["mispricing"],
      entrySnapshots,
    );
  });

  const openedPresetQmon = mustValue(qmonEngine.getQmon("PRESET01"));

  assert.equal(openedPresetQmon.strategyKind, "preset");
  assert.equal(openedPresetQmon.position.action, "BUY_UP");
  assert.equal(openedPresetQmon.pendingOrder, null);
  assert.equal(openedPresetQmon.decisionHistory.length, 1);
});

test("QmonEngine allows BUY_DOWN entries when downside outcome EV is positive after fees", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.9, 0.1)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(-0.9, 0.9, 0.1, marketStartMs, marketEndMs, 99_000, -0.2, -0.2),
      createRegimes(),
      ["consensus-flip"],
      entrySnapshots,
    );
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(-0.9, 0.9, 0.1, marketStartMs, marketEndMs, 99_000, -0.2, -0.2),
      createRegimes(),
      ["consensus-flip"],
      entrySnapshots,
    );
  });

  const openedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const entryDecision = mustValue(openedQmon.decisionHistory[0]);

  assert.equal(openedQmon.position.action, "BUY_DOWN");
  assert.equal(openedQmon.pendingOrder, null);
  assert.equal((entryDecision.estimatedNetEvUsd ?? 0) > 0, true);
  assert.equal(entryDecision.executionPrice, 0.1);
});

test("QmonEngine settles the champion seat without mutating the champion paper position", () => {
  const championQmon = createQmon("champion");
  const population = createPopulation([championQmon], championQmon.id);
  const familyState = createFamilyState({
    ...population,
    seatPosition: {
      action: "BUY_UP",
      enteredAt: 100,
      entryScore: 0.8,
      entryPrice: 0.1,
      peakReturnPct: null,
      shareCount: 5,
      priceToBeat: 100_000,
      marketStartMs: 100,
      marketEndMs: 200,
    },
    seatLastWindowStartMs: 100,
  });
  const qmonEngine = new QmonEngine(["btc"], ["5m"], familyState, undefined, undefined, undefined, false, false);

  withMockNow(300, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0, 0.9, 0.1, 100, 200, 101_000), createRegimes(), [], undefined, {
      shouldBlockEntries: true,
      shouldSkipEvolution: true,
    });
  });

  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));
  const updatedChampion = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(updatedPopulation.seatPosition.action, null);
  assert.equal(updatedPopulation.marketConsolidatedPnl > 0, true);
  assert.equal(updatedChampion.position.action, null);
  assert.equal(updatedChampion.decisionHistory.length, 0);
});

test("QmonEngine marks state mutation when a confirmed real seat fill updates market cpnl", () => {
  const championQmon = createQmon("champion");
  const familyState = createFamilyState({
    ...createPopulation([championQmon], championQmon.id),
    seatPendingOrder: {
      kind: "entry",
      action: "BUY_UP",
      score: 0.8,
      triggeredBy: ["consensus-flip"],
      requestedShares: 5,
      remainingShares: 5,
      limitPrice: 0.2,
      createdAt: 200,
      market: MARKET_KEY,
      marketStartMs: 400,
      marketEndMs: 700,
      priceToBeat: 101_000,
      entryDirectionRegime: "flat",
      entryVolatilityRegime: "normal",
      directionalAlpha: 0.8,
      estimatedEdgeBps: 30,
      estimatedNetEvUsd: 0.12,
      predictedSlippageBps: 5,
      predictedFillQuality: 1,
      signalAgreementCount: 2,
      dominantSignalGroup: "predictive",
      tradeabilityRejectReason: null,
    },
    seatLastWindowStartMs: 400,
  });
  const qmonEngine = new QmonEngine(["btc"], ["5m"], familyState, undefined, undefined, undefined, false, false);
  const initialSnapshotVersion = qmonEngine.getStateSnapshotVersion();

  qmonEngine.applyRealSeatPendingOrderFill(MARKET_KEY, 0.2, 5, 500);

  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));
  const updatedChampion = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(qmonEngine.getStateSnapshotVersion() > initialSnapshotVersion, true);
  assert.equal(updatedPopulation.marketConsolidatedPnl < 0, true);
  assert.equal(updatedPopulation.seatPosition.action, "BUY_UP");
  assert.equal(updatedPopulation.seatPendingOrder, null);
  assert.equal(updatedChampion.position.action, null);
  assert.equal(updatedChampion.pendingOrder, null);
  assert.equal(updatedChampion.metrics.totalPnl, 0);
  assert.equal(updatedChampion.decisionHistory.length, 0);
});

test("QmonEngine keeps champion paper evaluation running while live routing is halted", () => {
  const championQmon = createQmon("champion");
  const familyState = createFamilyState({
    ...createPopulation([championQmon], championQmon.id),
    executionRuntime: {
      route: "real",
      executionState: "real-halted",
      pendingIntent: null,
      orderId: null,
      submittedAt: 100,
      confirmedVenueSeat: null,
      pendingVenueOrders: [],
      recoveryStartedAt: null,
      lastReconciledAt: 100,
      lastError: "venue rejected order",
      isHalted: true,
    },
  });
  const qmonEngine = new QmonEngine(["btc"], ["5m"], familyState, undefined, undefined, undefined, false, false);
  const signals = createSignals(0.9, 0.1, 0.9, 100, 10_000);
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, signals, createRegimes(), ["consensus-flip"], snapshots, { executionMode: "real" });
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, signals, createRegimes(), ["consensus-flip"], snapshots, { executionMode: "real" });
  });

  const updatedChampion = mustValue(qmonEngine.getQmon("QMON01"));
  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(updatedChampion.position.action, "BUY_UP");
  assert.equal(updatedChampion.metrics.totalPnl < 0, true);
  assert.equal(updatedChampion.decisionHistory.length, 1);
  assert.equal(updatedPopulation.executionRuntime?.isHalted, true);
  assert.equal(updatedPopulation.executionRuntime?.lastError, "venue rejected order");
});

test("QmonEngine caps in-memory decision history to the most recent 20 decisions", () => {
  const baseQmon = createQmon();
  const decisionHistory: Qmon["decisionHistory"] = Array.from({ length: 25 }, (_, index) => ({
    timestamp: index + 1,
    market: MARKET_KEY,
    action: index % 2 === 0 ? "BUY_UP" : "HOLD",
    cashflow: index,
    modelScore: 0.5,
    triggeredBy: ["consensus-flip"],
    fee: 0,
    executionPrice: 0.2,
    entryPrice: 0.2,
    shareCount: 1,
    priceImpactBps: 0,
    isHydratedReplay: false,
  }));
  const qmonWithHistory: Qmon = {
    ...baseQmon,
    decisionHistory,
  };
  const familyState = createFamilyState(createPopulation([qmonWithHistory]));
  const qmonEngine = new QmonEngine(["btc"], ["5m"], familyState, undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const updatedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(updatedQmon.decisionHistory.length, 20);
  assert.equal(updatedQmon.decisionHistory[0]?.timestamp, 7);
  assert.equal(updatedQmon.decisionHistory[19]?.timestamp, 3000);
});

test("QmonEngine keeps the seat flat when the active champion loses readiness", () => {
  const staleChampionQmon: Qmon = {
    ...createQmon("champion"),
    metrics: {
      ...createQmon("champion").metrics,
      championScore: -5,
      fitnessScore: -10,
      isChampionEligible: false,
      championEligibilityReasons: ["non-positive-pnl"],
    },
  };
  const familyState = createFamilyState({
    ...createPopulation([staleChampionQmon], staleChampionQmon.id),
    seatPendingOrder: {
      kind: "entry",
      action: "BUY_UP",
      score: 0.9,
      triggeredBy: ["consensus-flip"],
      requestedShares: 5,
      remainingShares: 5,
      limitPrice: 0.1,
      createdAt: 500,
      market: MARKET_KEY,
      marketStartMs: 100,
      marketEndMs: 10_000,
      priceToBeat: 100_000,
      entryDirectionRegime: "flat",
      entryVolatilityRegime: "normal",
      directionalAlpha: 0.9,
      estimatedEdgeBps: 50,
      estimatedNetEvUsd: 0.1,
      predictedSlippageBps: 0,
      predictedFillQuality: 1,
      signalAgreementCount: 2,
      dominantSignalGroup: "predictive",
      tradeabilityRejectReason: null,
    },
  });
  const qmonEngine = new QmonEngine(["btc"], ["5m"], familyState, undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(updatedPopulation.seatPendingOrder, null);
  assert.equal(updatedPopulation.seatPosition.action, null);
  assert.equal(updatedPopulation.marketConsolidatedPnl, 0);
});

test("QmonChampionService preserves champion and seat state when real execution freezes rotation", () => {
  const championQmon: Qmon = {
    ...createQmon("champion"),
    currentWindowStart: 100,
    metrics: {
      ...createQmon("champion").metrics,
      championScore: 5,
      fitnessScore: 5,
      isChampionEligible: true,
      championEligibilityReasons: [],
    },
  };
  const familyState = createFamilyState({
    ...createPopulation([championQmon], championQmon.id),
    seatPendingOrder: {
      kind: "entry",
      action: "BUY_UP",
      score: 0.8,
      triggeredBy: ["consensus-flip"],
      requestedShares: 5,
      remainingShares: 5,
      limitPrice: 0.2,
      createdAt: 200,
      market: MARKET_KEY,
      marketStartMs: 400,
      marketEndMs: 700,
      priceToBeat: 101_000,
    },
    seatLastWindowStartMs: 100,
  });
  const championService = new QmonChampionService();
  const updatedPopulation = championService.finalizePopulation(
    familyState.populations[0]!,
    familyState.populations[0]!.qmons,
    {
      action: null,
      enteredAt: null,
      entryScore: null,
      entryPrice: null,
      peakReturnPct: null,
      shareCount: null,
      priceToBeat: null,
      marketStartMs: null,
      marketEndMs: null,
    },
    true,
  );

  assert.equal(updatedPopulation.activeChampionQmonId, championQmon.id);
  assert.equal(updatedPopulation.seatPosition.action, null);
  assert.equal(updatedPopulation.seatPendingOrder?.action, "BUY_UP");
  assert.equal(updatedPopulation.seatLastWindowStartMs, 100);
});

test("QmonEngine keeps real-routed seat entries pending instead of filling them in paper", () => {
  const championQmon: Qmon = {
    ...createQmon("champion"),
    metrics: {
      ...createQmon("champion").metrics,
      championScore: 5,
      fitnessScore: 5,
      isChampionEligible: true,
      championEligibilityReasons: [],
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([championQmon], championQmon.id)), undefined, undefined, undefined, false, false);
  const queueEntryOrder = (
    qmonEngine as unknown as {
      queueEntryOrder: (
        qmon: Qmon,
        action: "BUY_UP",
        score: number,
        tradeabilityAssessment: {
          readonly directionalAlpha: number;
          readonly estimatedEdgeBps: number;
          readonly estimatedNetEvUsd: number;
          readonly predictedSlippageBps: number;
          readonly predictedFillQuality: number;
          readonly signalAgreementCount: number;
          readonly dominantSignalGroup: "mixed";
          readonly tradeabilityRejectReason: null;
          readonly shouldAllowEntry: true;
        },
        triggeredBy: readonly string[],
        directionRegime: "flat",
        volatilityRegime: "normal",
        asset: "btc",
        window: "5m",
        market: typeof MARKET_KEY,
        priceToBeat: number,
        marketStartMs: number,
        marketEndMs: number,
        timestamp: number,
        results: [],
        snapshots: readonly Snapshot[],
        isSeat: true,
        shouldProcessImmediately: false,
      ) => Qmon;
    }
  ).queueEntryOrder.bind(qmonEngine);

  const queuedSeatQmon = queueEntryOrder(
    championQmon,
    "BUY_UP",
    1,
    {
      directionalAlpha: 1,
      estimatedEdgeBps: 1_200,
      estimatedNetEvUsd: 0.5,
      predictedSlippageBps: 30,
      predictedFillQuality: 0.5,
      signalAgreementCount: 2,
      dominantSignalGroup: "mixed",
      tradeabilityRejectReason: null,
      shouldAllowEntry: true,
    },
    ["consensus-flip"],
    "flat",
    "normal",
    "btc",
    "5m",
    MARKET_KEY,
    100_000,
    100,
    10_000,
    1_000,
    [],
    [createSnapshot(0.1, 0.9)],
    true,
    false,
  );

  assert.equal(queuedSeatQmon.pendingOrder?.kind, "entry");
  assert.equal(queuedSeatQmon.position.action, null);
  assert.equal(queuedSeatQmon.metrics.totalPnl, 0);
});

test("QmonEngine downgrades an under-sampled champion market to paper when real walk-forward is required", () => {
  const championService = new QmonChampionService();
  const championQmon = championService.refreshMetrics({
    ...createQmon("champion"),
    paperWindowPnls: [0.6, 0.7, 0.8, 0.9, 0.6],
    paperWindowSlippageBps: [10, 10, 10, 10, 10],
    metrics: {
      ...createQmon("champion").metrics,
      totalTrades: 3,
      totalPnl: 2.4,
      peakTotalPnl: 2.4,
      recentAvgSlippageBps: 10,
      totalFeesPaid: 0.2,
      winRate: 0.67,
      winCount: 2,
      maxDrawdown: 0.5,
      grossAlphaCapture: 2,
      feeRatio: 0.08,
      regimeBreakdown: [
        {
          regime: "regime:flat|normal",
          tradeCount: 3,
          totalPnl: 2.4,
          estimatedNetEvUsd: 1,
        },
        {
          regime: "regime:trending-up|normal",
          tradeCount: 1,
          totalPnl: 0.4,
          estimatedNetEvUsd: 0.2,
        },
      ],
    },
  });
  const qmonEngine = new QmonEngine(
    ["btc"],
    ["5m"],
    createFamilyState(createPopulation([championQmon], championQmon.id)),
    undefined,
    undefined,
    undefined,
    false,
    false,
  );

  qmonEngine.applyExecutionRoutes("real", 2);

  const population = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(population.executionRuntime?.route, "paper");
  assert.equal(population.realWalkForwardGate?.isPassed, false);
  assert.equal(population.realWalkForwardGate?.rejectReason, "walk-forward-insufficient-trades");
});

test("QmonEngine arms real routing when the champion passes the walk-forward gate", () => {
  const championService = new QmonChampionService();
  const championQmon = championService.refreshMetrics({
    ...createQmon("champion"),
    windowsLived: 20,
    paperWindowPnls: [0.8, 0.7, 0.9, 0.6, 0.8, 0.7],
    paperWindowSlippageBps: [12, 11, 12, 13, 10, 12],
    metrics: {
      ...createQmon("champion").metrics,
      totalTrades: 14,
      totalPnl: 4.2,
      peakTotalPnl: 4.2,
      totalFeesPaid: 0.35,
      winRate: 0.64,
      winCount: 9,
      maxDrawdown: 1.2,
      grossAlphaCapture: 4,
      regimeBreakdown: [
        {
          regime: "regime:flat|normal",
          tradeCount: 7,
          totalPnl: 2.2,
          estimatedNetEvUsd: 1.5,
        },
        {
          regime: "regime:trending-up|normal",
          tradeCount: 7,
          totalPnl: 2,
          estimatedNetEvUsd: 1.2,
        },
      ],
    },
  });
  const qmonEngine = new QmonEngine(
    ["btc"],
    ["5m"],
    createFamilyState(createPopulation([championQmon], championQmon.id)),
    undefined,
    undefined,
    undefined,
    false,
    false,
  );

  qmonEngine.applyExecutionRoutes("real", 2);

  const population = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(population.executionRuntime?.route, "real");
  assert.equal(population.realWalkForwardGate?.isPassed, true);
  assert.equal(population.realWalkForwardGate?.rejectReason, null);
});

test("QmonEngine reports cache hits and avoids global metric refresh churn on repeated ticks", () => {
  const firstQmon = createQmon();
  const secondQmon: Qmon = {
    ...createQmon(),
    id: "QMON02",
  };
  const signalEngine = SignalEngine.createDefault();
  const qmonEngine = new QmonEngine(
    ["btc"],
    ["5m"],
    createFamilyState(createPopulation([firstQmon, secondQmon])),
    signalEngine,
    undefined,
    undefined,
    false,
    false,
  );
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9), createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });
  withMockNow(1_500, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const stats = qmonEngine.getStats();

  assert.equal(stats.marketSignalsCacheMisses >= 1, true);
  assert.equal(stats.marketSignalsCacheHits >= 1, true);
  assert.equal(stats.metricsRefreshCount >= 1, true);
  assert.equal(stats.metricsRefreshCount < 10, true);
});
