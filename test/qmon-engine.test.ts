import * as assert from "node:assert/strict";
import { test } from "node:test";

import { QmonChampionService } from "../src/qmon/qmon-champion.service.ts";
import { QmonEngine } from "../src/qmon/qmon-engine.service.ts";
import type { MarketKey, Qmon, QmonFamilyState, QmonPopulation } from "../src/qmon/qmon.types.ts";
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

function createRegimes(): RegimeResult {
  return {
    btc: {
      direction: "flat",
      volatility: "normal",
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

function createSnapshot(upPrice: number, downPrice: number): Snapshot {
  return {
    generated_at: 1,
    btc_5m_up_order_book_json: JSON.stringify({
      bids: [{ price: upPrice, size: 50 }],
      asks: [{ price: upPrice, size: 50 }],
    }),
    btc_5m_down_order_book_json: JSON.stringify({
      bids: [{ price: downPrice, size: 50 }],
      asks: [{ price: downPrice, size: 50 }],
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

function createPopulation(qmons: readonly Qmon[], activeChampionQmonId: string | null = null): QmonPopulation {
  return {
    market: MARKET_KEY,
    qmons,
    createdAt: 1,
    lastUpdated: 1,
    activeChampionQmonId,
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

  assert.equal(population.qmons.length, 100);
  assert.equal(new Set(population.qmons.map((qmon) => JSON.stringify(qmon.genome))).size, 100);
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
  withMockNow(1_500, () => {
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
  withMockNow(2_500, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(-0.9, 0.7, 0.3, marketStartMs, marketEndMs), createRegimes(), [], exitSnapshots);
  });

  const closedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const exitDecision = mustValue(closedQmon.decisionHistory[1]);

  assert.equal(closedQmon.position.action, null);
  assert.equal(closedQmon.metrics.totalTrades, 1);
  assert.equal((exitDecision.modelScore ?? 0) > 0.5, true);
  assert.equal(exitDecision.cashflow > 0, true);
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

  assert.equal(qmonEngine.getStateSnapshotVersion() > initialSnapshotVersion, true);
  assert.equal(updatedPopulation.marketConsolidatedPnl < 0, true);
  assert.equal(updatedPopulation.seatPosition.action, "BUY_UP");
  assert.equal(updatedPopulation.seatPendingOrder, null);
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
  const snapshots = [createSnapshot(0.1, 0.9)];

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
