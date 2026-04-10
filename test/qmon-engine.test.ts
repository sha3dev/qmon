import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonChampionService } from "../src/qmon/qmon-champion.service.ts";
import { QmonEngine } from "../src/qmon/qmon-engine.service.ts";
import { QmonPresetStrategyService } from "../src/qmon/qmon-preset-strategy.service.ts";
import type { DirectionRegimeValue, MarketKey, Qmon, QmonDecision, QmonFamilyState, QmonPopulation, VolatilityRegimeValue } from "../src/qmon/qmon.types.ts";
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
  spread = 0,
  bookDepth = 0,
  imbalance = signalValue,
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
        imbalance,
        microprice: 0,
        staleness: 0,
        acceleration: 0,
        volatilityRegime: 0,
        spread,
        bookDepth,
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
      beliefWeights: {
        spotOracleAlignment: 1.2,
        resolutionMomentum: 0.9,
        consensusPersistence: 1,
        microstructureStability: 0.8,
        bookFreshness: 0.7,
        marketDivergence: 0.5,
      },
      timeWindowGenes: [true, true, true],
      directionRegimeGenes: [true, true, true],
      volatilityRegimeGenes: [true, true, true],
      exchangeWeights: [0.25, 0.25, 0.25, 0.25],
      entryPolicy: {
        confidenceThreshold: 0.6,
        confirmationRequirement: 2,
        maxSpreadPenaltyBps: 100,
        maxSlippageBps: 1_500,
        minFillQuality: 0.2,
        uncertaintyTolerance: 0.55,
      },
      executionPolicy: {
        sizeTier: 2,
        maxTradesPerWindow: 2,
        cooldownProfile: "tight",
      },
      exitPolicy: {
        thesisCollapseProbability: 0.4,
        extremeDrawdownPct: 0.85,
      },
      riskBudgetUsd: config.QMON_MAX_ENTRY_RISK_USD,
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
    shadowPosition: null,
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
      shadowResolvedCount: 0,
      shadowCorrectCount: 0,
      shadowBrierScoreSum: 0,
      shadowNetPnl: 0,
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
  const presetStrategyDefinition = presetStrategyService.getPresetStrategyDefinition("consensus-resolver-01");

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
    genome: {
      ...presetStrategyService.createCompatibilityGenome(presetStrategyDefinition),
      riskBudgetUsd: config.QMON_MAX_ENTRY_RISK_USD,
    },
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

function attachSettledTrades(
  qmon: Qmon,
  trades: readonly {
    readonly entryCashflow: number;
    readonly exitCashflow: number;
    readonly estimatedNetEvUsd: number;
  }[],
): Qmon {
  const decisionHistory: QmonDecision[] = [];
  let timestamp = 10;

  for (const trade of trades) {
    decisionHistory.push({
      timestamp,
      market: qmon.market,
      action: "BUY_UP",
      cashflow: trade.entryCashflow,
      modelScore: 0.8,
      triggeredBy: ["test-entry"],
      fee: 0.01,
      executionPrice: 0.2,
      entryPrice: 0.2,
      shareCount: 5,
      priceImpactBps: 5,
      isHydratedReplay: false,
      directionalAlpha: 0.8,
      finalOutcomeProbability: 0.7,
      marketImpliedProbability: 0.2,
      estimatedEdgeBps: 5000,
      estimatedNetEvUsd: trade.estimatedNetEvUsd,
      predictedSlippageBps: 20,
      tradeabilityRejectReason: null,
      riskBudgetUsd: 1,
      signalAgreementCount: 3,
      dominantSignalGroup: "predictive",
    });
    timestamp += 1;
    decisionHistory.push({
      timestamp,
      market: qmon.market,
      action: "HOLD",
      cashflow: trade.exitCashflow,
      modelScore: 0.4,
      triggeredBy: ["test-exit"],
      fee: 0.01,
      executionPrice: 0.4,
      entryPrice: 0.2,
      shareCount: 5,
      priceImpactBps: 5,
      isHydratedReplay: false,
      directionalAlpha: 0.4,
      finalOutcomeProbability: 0.6,
      marketImpliedProbability: 0.2,
      estimatedEdgeBps: 4000,
      estimatedNetEvUsd: trade.estimatedNetEvUsd,
      predictedSlippageBps: 20,
      tradeabilityRejectReason: null,
      riskBudgetUsd: 1,
      signalAgreementCount: 3,
      dominantSignalGroup: "predictive",
    });
    timestamp += 1;
  }

  return {
    ...qmon,
    decisionHistory,
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

test("QmonEngine holds a winning position until settlement and then realizes cashflow", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 5_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];
  const inFlightSnapshots = [createSnapshot(0.8, 0.2)];

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
  assert.equal((entryDecision.modelScore ?? 0) > 0, true);
  assert.equal(entryDecision.cashflow < 0, true);
  assert.equal(entryDecision.entryDirectionRegime, "flat");
  assert.equal(entryDecision.entryVolatilityRegime, "normal");
  assert.equal(openedQmon.position.entryDirectionRegime, "flat");
  assert.equal(openedQmon.position.entryVolatilityRegime, "normal");
  assert.equal(Object.hasOwn(entryDecision, "score"), false);

  withMockNow(4_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.8, 0.2, marketStartMs, marketEndMs), createRegimes(), [], inFlightSnapshots);
  });

  const stillOpenQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(stillOpenQmon.position.action, "BUY_UP");

  withMockNow(6_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.8, 0.2, marketStartMs, marketEndMs, 101_000), createRegimes(), [], inFlightSnapshots);
  });

  const closedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const exitDecision = mustValue(closedQmon.decisionHistory[1]);

  assert.equal(closedQmon.position.action, null);
  assert.equal(closedQmon.metrics.totalTrades, 1);
  assert.equal(exitDecision.triggeredBy[0], "market-settled");
  assert.equal(exitDecision.cashflow > 0, true);
});

test("QmonEngine exits early only when the final-outcome thesis collapses", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];
  const collapseSnapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], entrySnapshots);
  });
  withMockNow(4_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(-0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, -1, -1), createRegimes(), [], collapseSnapshots);
  });
  withMockNow(6_500, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(-0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, -1, -1), createRegimes(), [], collapseSnapshots);
  });
  withMockNow(8_500, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(-0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, -1, -1), createRegimes(), [], collapseSnapshots);
  });

  const closedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const exitDecision = mustValue(closedQmon.decisionHistory[1]);

  assert.equal(closedQmon.position.action, null);
  assert.equal(exitDecision.triggeredBy[0], "thesis-collapsed");
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

test("QmonEngine resolves one shadow hypothesis for a filtered no-trade without replaying the market", () => {
  const qmon = {
    ...createQmon(),
    genome: {
      ...createQmon().genome,
      entryPolicy: {
        ...createQmon().genome.entryPolicy,
        confidenceThreshold: 0.95,
      },
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([qmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 5_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const qmonWithShadow = mustValue(qmonEngine.getQmon("QMON01"));

  assert.notEqual(qmonWithShadow.shadowPosition, null);
  assert.equal(qmonWithShadow.position.action, null);
  assert.equal(qmonWithShadow.metrics.shadowResolvedCount, 0);

  withMockNow(6_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 101_000), createRegimes(), [], snapshots);
  });

  const resolvedShadowQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(resolvedShadowQmon.shadowPosition, null);
  assert.equal(resolvedShadowQmon.metrics.shadowResolvedCount, 1);
  assert.equal(resolvedShadowQmon.metrics.shadowCorrectCount, 1);
  assert.equal((resolvedShadowQmon.metrics.shadowNetPnl ?? 0) > 0, true);
  assert.equal((resolvedShadowQmon.metrics.shadowBrierScoreSum ?? 1) < 0.2, true);
});

test("QmonEngine does not duplicate shadow evidence for entries that already execute in paper", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 5_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const queuedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(queuedQmon.shadowPosition, null);

  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });
  withMockNow(6_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.8, 0.2, marketStartMs, marketEndMs, 101_000), createRegimes(), [], snapshots);
  });

  const tradedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(tradedQmon.shadowPosition, null);
  assert.equal(tradedQmon.metrics.shadowResolvedCount, 0);
  assert.equal(tradedQmon.metrics.shadowNetPnl, 0);
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

test("QmonEngine uses minimum entry shares when the risk budget can fund the minimum ticket", () => {
  const qmon = createQmon();
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([{
    ...qmon,
    genome: {
      ...qmon.genome,
      riskBudgetUsd: 2,
    },
  }])), undefined, undefined, undefined, false, false);
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

test("QmonEngine falls back to belief labels when no trigger fired", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), [], snapshots);
  });

  const pendingQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(pendingQmon.position.action, null);
  assert.deepEqual(pendingQmon.pendingOrder?.triggeredBy, ["belief:genetic", "confidence:0.60"]);
  assert.equal(pendingQmon.decisionHistory.length, 0);
});

test("QmonEngine deduplicates repeated trigger ids on one trade", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 5_000;
  const entrySnapshots = [createSnapshot(0.9, 0.1)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(-0.9, 0.9, 0.1, marketStartMs, marketEndMs, 100_000, -1, -1),
      createRegimes(),
      ["consensus-flip", "consensus-flip", "consensus-flip"],
      entrySnapshots,
    );
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(-0.9, 0.9, 0.1, marketStartMs, marketEndMs, 100_000, -1, -1),
      createRegimes(),
      ["consensus-flip", "consensus-flip"],
      entrySnapshots,
    );
  });

  const openedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.deepEqual(openedQmon.position.entryTriggers, ["consensus-flip"]);

  withMockNow(6_500, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 99_000, 1, 1),
      createRegimes(),
      [],
      entrySnapshots,
    );
  });

  const closedQmon = mustValue(qmonEngine.getQmon("QMON01"));
  const triggerBreakdown = closedQmon.metrics.triggerBreakdown ?? [];

  assert.equal(triggerBreakdown.length, 1);
  assert.equal(triggerBreakdown[0]?.triggerId, "consensus-flip");
  assert.equal(triggerBreakdown[0]?.tradeCount, 1);
});

test("QmonEngine blocks new entries when market execution quality is severely stressed", () => {
  const stressedPopulation: QmonPopulation = {
    ...createPopulation([createQmon()]),
    executionQuality: {
      resolvedOrderCount: 20,
      filledOrderCount: 8,
      rejectedOrderCount: 12,
      timedOutOrderCount: 4,
      slippageRejectedOrderCount: 8,
      avgFilledPriceImpactBps: 260,
      avgRejectedSlippageBps: 540,
      fillRate: 0.4,
      rejectionRate: 0.6,
      stressScore: 1,
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(stressedPopulation), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.3, 0.7)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.3, 0.7, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const blockedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(blockedQmon.position.action, null);
  assert.equal(blockedQmon.pendingOrder, null);
  assert.equal(blockedQmon.decisionHistory.length, 0);
});

test("QmonEngine ignores stressed execution quality until there is enough market evidence", () => {
  const lowEvidencePopulation: QmonPopulation = {
    ...createPopulation([createQmon()]),
    executionQuality: {
      resolvedOrderCount: 2,
      filledOrderCount: 0,
      rejectedOrderCount: 2,
      timedOutOrderCount: 1,
      slippageRejectedOrderCount: 2,
      avgFilledPriceImpactBps: 0,
      avgRejectedSlippageBps: 540,
      fillRate: 0,
      rejectionRate: 1,
      stressScore: 1,
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(lowEvidencePopulation), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });
  withMockNow(5_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs), createRegimes(), ["consensus-flip"], snapshots);
  });

  const openedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(openedQmon.position.action, "BUY_UP");
  assert.equal(openedQmon.pendingOrder, null);
  assert.equal(openedQmon.decisionHistory.length, 1);
});

test("QmonEngine quarantines persistently underperforming strategies", () => {
  const underperformingQmon: Qmon = {
    ...createQmon(),
    windowsLived: 8,
    paperWindowPnls: [-1, -1, -0.5, -0.3, -0.2, -0.4],
    metrics: {
      ...createQmon().metrics,
      totalTrades: 8,
      totalPnl: -4,
      fitnessScore: -25,
      paperWindowPnlSum: -3.4,
      paperLongWindowPnlSum: -3.4,
      winRate: 0.25,
      winCount: 2,
      maxDrawdown: 4,
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([underperformingQmon])), undefined, undefined, undefined, false, false);
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
        confirmationRequirement: 4,
      },
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([signalLockedQmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const snapshots = [createSnapshot(0.1, 0.9)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, 0, 0), createRegimes(), ["consensus-flip"], snapshots);
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

test("QmonEngine allows BUY_DOWN entries when downside final-outcome confidence is high", () => {
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

test("QmonEngine caps cheap outcome sizing by worst-case USD risk", () => {
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([createQmon()])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.02, 0.98, 100, 50)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.9, 0.02, 0.98, marketStartMs, marketEndMs, 100_000, 1, 1),
      createRegimes(),
      ["consensus-flip"],
      entrySnapshots,
    );
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.9, 0.02, 0.98, marketStartMs, marketEndMs, 100_000, 1, 1),
      createRegimes(),
      ["consensus-flip"],
      entrySnapshots,
    );
  });

  const sizedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(sizedQmon.position.action, "BUY_UP");
  assert.equal((sizedQmon.position.shareCount ?? 0) < 60, true);
  assert.equal((sizedQmon.position.riskBudgetUsd ?? 0) <= config.QMON_MAX_ENTRY_RISK_USD, true);
});

test("QmonEngine reports position-size-invalid when the risk budget cannot fund the minimum entry", () => {
  const qmon = createQmon();
  const sizeBlockedQmon: Qmon = {
    ...qmon,
    genome: {
      ...qmon.genome,
      riskBudgetUsd: 0.5,
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([sizeBlockedQmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];
  const inspectedEngine = qmonEngine as unknown as {
    getMarketSignals: typeof qmonEngine["getMarketSignals"];
    computeDirectionalAlpha: typeof qmonEngine["computeDirectionalAlpha"];
    assessTradeability: typeof qmonEngine["assessTradeability"];
  };
  const marketSignals = inspectedEngine.getMarketSignals(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, 1, 1), sizeBlockedQmon, entrySnapshots);
  const directionalAlphaResult = inspectedEngine.computeDirectionalAlpha(sizeBlockedQmon, marketSignals, "flat", "normal", "mid");
  const tradeabilityAssessment = inspectedEngine.assessTradeability(
    sizeBlockedQmon,
    "BUY_UP",
    directionalAlphaResult,
    marketSignals,
    ["consensus-flip"],
    0.1,
    undefined,
  );

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(MARKET_KEY, createSignals(0.9, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, 1, 1), createRegimes(), ["consensus-flip"], entrySnapshots);
  });

  const updatedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(tradeabilityAssessment.tradeabilityRejectReason, "position-size-invalid");
  assert.equal(updatedQmon.position.action, null);
  assert.equal(updatedQmon.pendingOrder, null);
});

test("QmonEngine bootstrap can open a high-priced market when notional sizing is enabled", () => {
  const qmon = createQmon();
  const bootstrapQmon: Qmon = {
    ...qmon,
    genome: {
      ...qmon.genome,
      riskBudgetUsd: 1.45,
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([bootstrapQmon])), undefined, undefined, undefined, false, false);
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.42, 0.58, 100, 100)];

  withMockNow(1_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.95, 0.42, 0.58, marketStartMs, marketEndMs, 100_000, 0.8, 0.8, 0.01, 0.6, 0.9),
      createRegimes(),
      ["consensus-flip"],
      entrySnapshots,
    );
  });
  withMockNow(3_000, () => {
    qmonEngine.evaluatePopulation(
      MARKET_KEY,
      createSignals(0.95, 0.42, 0.58, marketStartMs, marketEndMs, 100_000, 0.8, 0.8, 0.01, 0.6, 0.9),
      createRegimes(),
      ["consensus-flip"],
      entrySnapshots,
    );
  });

  const openedQmon = mustValue(qmonEngine.getQmon("QMON01"));

  assert.equal(openedQmon.position.action, "BUY_UP");
  assert.equal((openedQmon.position.shareCount ?? 0) >= 2, true);
  assert.equal((openedQmon.position.shareCount ?? 0) < 5, true);
});

test("QmonEngine keeps high-conviction entries tradeable under moderate self-stress", () => {
  const qmon = createQmon();
  const stressedQmon: Qmon = {
    ...qmon,
    metrics: {
      ...qmon.metrics,
      feeRatio: 0.8,
      recentAvgSlippageBps: 200,
    },
  };
  const qmonEngine = new QmonEngine(["btc"], ["5m"], createFamilyState(createPopulation([stressedQmon])), undefined, undefined, undefined, false, false);
  const inspectedEngine = qmonEngine as unknown as {
    getMarketSignals: typeof qmonEngine["getMarketSignals"];
    computeDirectionalAlpha: typeof qmonEngine["computeDirectionalAlpha"];
    assessTradeability: typeof qmonEngine["assessTradeability"];
  };
  const marketStartMs = 100;
  const marketEndMs = 10_000;
  const entrySnapshots = [createSnapshot(0.1, 0.9)];
  const marketSignals = inspectedEngine.getMarketSignals(
    MARKET_KEY,
    createSignals(0.95, 0.1, 0.9, marketStartMs, marketEndMs, 100_000, 0.3, 0.3, 0.1, 1, 0.95),
    stressedQmon,
    entrySnapshots,
  );
  const directionalAlphaResult = inspectedEngine.computeDirectionalAlpha(stressedQmon, marketSignals, "flat", "normal", "mid");
  const tradeabilityAssessment = inspectedEngine.assessTradeability(
    stressedQmon,
    "BUY_UP",
    directionalAlphaResult,
    marketSignals,
    ["consensus-flip"],
    0.1,
    undefined,
  );

  assert.equal(tradeabilityAssessment.shouldAllowEntry, true);
  assert.equal(tradeabilityAssessment.tradeabilityRejectReason, null);
  assert.equal(tradeabilityAssessment.predictedSlippageBps < config.QMON_MAX_ENTRY_SLIPPAGE_BPS, true);
  assert.equal(
    tradeabilityAssessment.finalOutcomeProbability >= Math.max(stressedQmon.genome.entryPolicy.confidenceThreshold, config.QMON_MIN_FINAL_OUTCOME_PROBABILITY),
    true,
  );
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
      finalOutcomeProbability: 0.72,
      marketImpliedProbability: 0.2,
      estimatedEdgeBps: 30,
      estimatedNetEvUsd: 0.12,
      predictedSlippageBps: 5,
      predictedFillQuality: 1,
      riskBudgetUsd: config.QMON_MAX_ENTRY_RISK_USD,
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
      finalOutcomeProbability: 0.74,
      marketImpliedProbability: 0.1,
      estimatedEdgeBps: 50,
      estimatedNetEvUsd: 0.1,
      predictedSlippageBps: 0,
      predictedFillQuality: 1,
      riskBudgetUsd: config.QMON_MAX_ENTRY_RISK_USD,
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
          readonly finalOutcomeProbability: number;
          readonly marketImpliedProbability: number;
          readonly estimatedEdgeBps: number;
          readonly estimatedNetEvUsd: number;
          readonly predictedSlippageBps: number;
          readonly predictedFillQuality: number;
          readonly riskBudgetUsd: number;
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
      finalOutcomeProbability: 0.8,
      marketImpliedProbability: 0.2,
      estimatedEdgeBps: 1_200,
      estimatedNetEvUsd: 0.5,
      predictedSlippageBps: 30,
      predictedFillQuality: 0.5,
      riskBudgetUsd: config.QMON_MAX_ENTRY_RISK_USD,
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

test("QmonEngine downgrades a non-production-ready champion market to paper when real routing is requested", () => {
  const championService = new QmonChampionService();
  const championQmon = championService.refreshMetrics({
    ...attachSettledTrades(createQmon("champion"), [
      { entryCashflow: -1, exitCashflow: 2.1, estimatedNetEvUsd: 2 },
      { entryCashflow: -1, exitCashflow: 2.2, estimatedNetEvUsd: 2 },
      { entryCashflow: -1, exitCashflow: 2.3, estimatedNetEvUsd: 2 },
    ]),
    paperWindowPnls: [0.6, 0.7, 0.8, 0.9, 0.6],
    paperWindowSlippageBps: [10, 10, 10, 10, 10],
    metrics: {
      ...createQmon("champion").metrics,
      totalTrades: 12,
      totalPnl: 2.4,
      peakTotalPnl: 2.4,
      recentAvgSlippageBps: 120,
      totalFeesPaid: 0.2,
      winRate: 0.67,
      winCount: 8,
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
  const population = {
    ...createPopulation([championQmon], championQmon.id),
    executionQuality: {
      resolvedOrderCount: 30,
      filledOrderCount: 5,
      rejectedOrderCount: 25,
      timedOutOrderCount: 0,
      slippageRejectedOrderCount: 20,
      avgFilledPriceImpactBps: 20,
      avgRejectedSlippageBps: 120,
      fillRate: 0.16,
      rejectionRate: 0.84,
      stressScore: 0.8,
    },
  };
  const qmonEngine = new QmonEngine(
    ["btc"],
    ["5m"],
    createFamilyState(population),
    undefined,
    undefined,
    undefined,
    false,
    false,
  );

  qmonEngine.applyExecutionRoutes("real", 2);

  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(updatedPopulation.executionRuntime?.route, "paper");
  assert.equal(updatedPopulation.realWalkForwardGate?.isPassed, false);
  assert.equal(updatedPopulation.realWalkForwardGate?.rejectReason, "market-health-blocked");
  assert.equal(updatedPopulation.marketHealth?.state, "blocked");
});

test("QmonEngine arms real routing for an eligible champion while market health is still observing", () => {
  const championService = new QmonChampionService();
  const championQmon = championService.refreshMetrics({
    ...attachSettledTrades(createQmon("champion"), [
      { entryCashflow: -1, exitCashflow: 2.1, estimatedNetEvUsd: 2 },
      { entryCashflow: -1, exitCashflow: 2.2, estimatedNetEvUsd: 2 },
      { entryCashflow: -1, exitCashflow: 2.3, estimatedNetEvUsd: 2 },
    ]),
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
  const population = {
    ...createPopulation([championQmon], championQmon.id),
    executionQuality: {
      resolvedOrderCount: 30,
      filledOrderCount: 12,
      rejectedOrderCount: 18,
      timedOutOrderCount: 0,
      slippageRejectedOrderCount: 4,
      avgFilledPriceImpactBps: 12,
      avgRejectedSlippageBps: 40,
      fillRate: 0.4,
      rejectionRate: 0.6,
      stressScore: 0.35,
    },
  };
  const qmonEngine = new QmonEngine(
    ["btc"],
    ["5m"],
    createFamilyState(population),
    undefined,
    undefined,
    undefined,
    false,
    false,
  );

  qmonEngine.applyExecutionRoutes("real", 2);

  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(updatedPopulation.executionRuntime?.route, "real");
  assert.equal(updatedPopulation.realWalkForwardGate?.isPassed, true);
  assert.equal(updatedPopulation.realWalkForwardGate?.rejectReason, null);
  assert.equal(updatedPopulation.marketHealth?.state, "observation-only");
});

test("QmonEngine arms real routing when the champion passes the walk-forward gate", () => {
  const championService = new QmonChampionService();
  const championQmon = championService.refreshMetrics({
    ...attachSettledTrades(createQmon("champion"), [
      { entryCashflow: -1, exitCashflow: 2.1, estimatedNetEvUsd: 2 },
      { entryCashflow: -1, exitCashflow: 2.2, estimatedNetEvUsd: 2 },
      { entryCashflow: -1, exitCashflow: 2.3, estimatedNetEvUsd: 2 },
    ]),
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
  const population = {
    ...createPopulation([championQmon], championQmon.id),
    executionQuality: {
      resolvedOrderCount: 30,
      filledOrderCount: 18,
      rejectedOrderCount: 12,
      timedOutOrderCount: 0,
      slippageRejectedOrderCount: 4,
      avgFilledPriceImpactBps: 12,
      avgRejectedSlippageBps: 40,
      fillRate: 0.6,
      rejectionRate: 0.4,
      stressScore: 0.2,
    },
  };
  const qmonEngine = new QmonEngine(
    ["btc"],
    ["5m"],
    createFamilyState(population),
    undefined,
    undefined,
    undefined,
    false,
    false,
  );

  qmonEngine.applyExecutionRoutes("real", 2);

  const updatedPopulation = mustValue(qmonEngine.getPopulation(MARKET_KEY));

  assert.equal(updatedPopulation.executionRuntime?.route, "real");
  assert.equal(updatedPopulation.realWalkForwardGate?.isPassed, true);
  assert.equal(updatedPopulation.realWalkForwardGate?.rejectReason, null);
  assert.equal(updatedPopulation.marketHealth?.state, "healthy");
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
