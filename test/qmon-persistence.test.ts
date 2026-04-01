import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { QmonPersistenceService } from "../src/qmon/qmon-persistence.service.ts";
import type { QmonFamilyState } from "../src/qmon/qmon.types.ts";

function createFamilyState(): QmonFamilyState {
  return {
    populations: [
      {
        market: "btc-5m",
        createdAt: 10,
        lastUpdated: 11,
        activeChampionQmonId: "QMON01",
        marketConsolidatedPnl: 2.5,
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
        seatLastWindowStartMs: 1_000,
        seatLastSettledWindowStartMs: 900,
        qmons: [
          {
            id: "QMON01",
            market: "btc-5m",
            genome: {
              predictiveSignalGenes: [{ signalId: "edge", orientation: "aligned", weightTier: 2 }],
              microstructureSignalGenes: [{ signalId: "imbalance", orientation: "aligned", weightTier: 1 }],
              signalGenes: [
                { signalId: "edge", weights: { _default: 2 } },
                { signalId: "imbalance", weights: { _default: 1 } },
              ],
              triggerGenes: [{ triggerId: "consensus-flip", isEnabled: true }],
              timeWindowGenes: [true, true, true],
              directionRegimeGenes: [true, true, true],
              volatilityRegimeGenes: [true, true, true],
              exchangeWeights: [0.25, 0.25, 0.25, 0.25],
              entryPolicy: {
                minEdgeBps: 25,
                minNetEvUsd: 0.05,
                minConfirmations: 2,
                maxSpreadPenaltyBps: 40,
                maxSlippageBps: 300,
                minFillQuality: 0.45,
              },
              executionPolicy: {
                sizeTier: 2,
                maxTradesPerWindow: 2,
                cooldownProfile: "balanced",
              },
              exitPolicy: {
                extremeStopLossPct: 0.3,
                extremeTakeProfitPct: 0.5,
                thesisInvalidationPolicy: "hybrid",
              },
              maxTradesPerWindow: 2,
              maxSlippageBps: 300,
              minScoreBuy: 0.5,
              minScoreSell: 0.4,
              stopLossPct: 0.3,
              takeProfitPct: 0.5,
            },
            role: "champion",
            lifecycle: "active",
            generation: 2,
            parentIds: ["QMONAA", "QMONBB"],
            createdAt: 12,
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
            pendingOrder: {
              kind: "entry",
              action: "BUY_UP",
              score: 0.82,
              triggeredBy: ["consensus-flip"],
              requestedShares: 5,
              remainingShares: 5,
              limitPrice: 0.42,
              createdAt: 20,
              market: "btc-5m",
              marketStartMs: 100,
              marketEndMs: 200,
              priceToBeat: 100_000,
            },
            metrics: {
              totalTrades: 3,
              totalPnl: 4.2,
              championScore: 8.5,
              paperWindowMedianPnl: 1.1,
              paperWindowPnlSum: 2.1,
              paperLongWindowPnlSum: 4.2,
              negativeWindowRateLast10: 0.1,
              worstWindowPnlLast10: -0.4,
              recentAvgSlippageBps: 12,
              isChampionEligible: true,
              championEligibilityReasons: [],
              totalFeesPaid: 0.33,
              winRate: 0.67,
              winCount: 2,
              avgScore: 0.55,
              maxDrawdown: 0.2,
              lastUpdate: 21,
            },
            decisionHistory: [
              {
                timestamp: 19,
                market: "btc-5m",
                action: "BUY_UP",
                modelScore: 0.82,
                cashflow: -2.1,
                triggeredBy: ["consensus-flip"],
                fee: 0.04,
                executionPrice: 0.42,
                entryPrice: 0.42,
                shareCount: 5,
                priceImpactBps: 8,
                isHydratedReplay: false,
              },
            ],
            windowTradeCount: 1,
            windowsLived: 12,
            paperWindowPnls: [1.4, 0.7],
            paperWindowSlippageBps: [8, 16],
            paperWindowBaselinePnl: 0.4,
            currentWindowStart: 100,
            currentWindowSlippageTotalBps: 16,
            currentWindowSlippageFillCount: 2,
            lastCloseTimestamp: null,
          },
        ],
      },
    ],
    globalGeneration: 5,
    createdAt: 1,
    lastUpdated: 2,
  };
}

test("QmonPersistenceService round-trips the family state through a single atomic file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "qmon-persistence-"));
  const persistenceService = new QmonPersistenceService(tempDir);
  const familyState = createFamilyState();

  try {
    const wasSaved = await persistenceService.save(familyState);
    const serializedState = await readFile(join(tempDir, "family-state.json"), "utf-8");
    const loadedState = await persistenceService.load();

    assert.equal(wasSaved, true);
    assert.equal(serializedState.includes('"globalGeneration": 5'), true);
    assert.ok(loadedState);
    assert.equal(loadedState.populations[0]?.activeChampionQmonId, "QMON01");
    assert.equal(loadedState.populations[0]?.marketConsolidatedPnl, 2.5);
    assert.equal(loadedState.populations[0]?.qmons[0]?.pendingOrder?.action, "BUY_UP");
    assert.equal(loadedState.populations[0]?.qmons[0]?.decisionHistory[0]?.modelScore, 0.82);
    assert.equal(loadedState.populations[0]?.qmons[0]?.decisionHistory[0]?.cashflow, -2.1);
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.totalFeesPaid, 0.33);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("QmonPersistenceService serializes concurrent family-state writes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "qmon-persistence-"));
  const persistenceService = new QmonPersistenceService(tempDir);
  const baseFamilyState = createFamilyState();
  const firstState: QmonFamilyState = {
    ...baseFamilyState,
    lastUpdated: 10,
  };
  const secondState: QmonFamilyState = {
    ...baseFamilyState,
    lastUpdated: 20,
  };

  try {
    const saveResults = await Promise.all([persistenceService.save(firstState), persistenceService.save(secondState)]);
    const loadedState = await persistenceService.load();

    assert.deepEqual(saveResults, [true, true]);
    assert.ok(loadedState);
    assert.equal(loadedState.lastUpdated, 20);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("QmonPersistenceService derives markets from configured assets and windows", () => {
  const persistenceService = new QmonPersistenceService("/tmp/qmon-persistence");
  const allMarkets = persistenceService.getAllMarkets();

  assert.equal(allMarkets.includes("btc-5m"), true);
  assert.equal(allMarkets.includes("eth-5m"), true);
  assert.equal(allMarkets.length > 0, true);
});

test("QmonPersistenceService resets market CPnL state without losing QMON populations", () => {
  const persistenceService = new QmonPersistenceService("/tmp/qmon-persistence");
  const baseFamilyState = createFamilyState();
  const familyState: QmonFamilyState = {
    ...baseFamilyState,
    populations: [
      {
        ...baseFamilyState.populations[0]!,
        seatPosition: {
          action: "BUY_UP",
          enteredAt: 100,
          entryScore: 0.82,
          entryPrice: 0.42,
          peakReturnPct: 0.15,
          shareCount: 5,
          priceToBeat: 100_000,
          marketStartMs: 100,
          marketEndMs: 200,
          entryTriggers: ["consensus-flip"],
          entryDirectionRegime: "flat",
          entryVolatilityRegime: "normal",
          directionalAlpha: 0.82,
          estimatedEdgeBps: 12,
          estimatedNetEvUsd: 0.3,
          predictedSlippageBps: 5,
          predictedFillQuality: 0.8,
          signalAgreementCount: 2,
          dominantSignalGroup: "predictive",
        },
        seatPendingOrder: {
          kind: "exit",
          action: "SELL_UP",
          score: 0.3,
          triggeredBy: ["take-profit-hit"],
          requestedShares: 5,
          remainingShares: 5,
          limitPrice: 0.7,
          createdAt: 120,
          market: "btc-5m",
          marketStartMs: 100,
          marketEndMs: 200,
          priceToBeat: 100_000,
        },
        seatLastCloseTimestamp: 130,
        marketConsolidatedPnl: 7.25,
      },
    ],
  };

  const resetState = persistenceService.resetCpnlState(familyState);

  assert.equal(resetState.populations[0]?.marketConsolidatedPnl, 0);
  assert.equal(resetState.populations[0]?.seatPosition.action, null);
  assert.equal(resetState.populations[0]?.seatPendingOrder, null);
  assert.equal(resetState.populations[0]?.seatLastCloseTimestamp, null);
  assert.equal(resetState.populations[0]?.qmons.length, 1);
  assert.equal(resetState.populations[0]?.qmons[0]?.id, "QMON01");
  assert.equal(resetState.populations[0]?.qmons[0]?.metrics.totalPnl, 4.2);
});

test("QmonPersistenceService preserves real market seat state during CPnL reset", () => {
  const persistenceService = new QmonPersistenceService("/tmp/qmon-persistence");
  const baseFamilyState = createFamilyState();
  const familyState: QmonFamilyState = {
    ...baseFamilyState,
    populations: [
      {
        ...baseFamilyState.populations[0]!,
        seatPosition: {
          action: "BUY_UP",
          enteredAt: 100,
          entryScore: 0.82,
          entryPrice: 0.42,
          peakReturnPct: 0.15,
          shareCount: 5,
          priceToBeat: 100_000,
          marketStartMs: 100,
          marketEndMs: 200,
          entryTriggers: ["consensus-flip"],
          entryDirectionRegime: "flat",
          entryVolatilityRegime: "normal",
          directionalAlpha: 0.82,
          estimatedEdgeBps: 12,
          estimatedNetEvUsd: 0.3,
          predictedSlippageBps: 5,
          predictedFillQuality: 0.8,
          signalAgreementCount: 2,
          dominantSignalGroup: "predictive",
        },
        seatPendingOrder: {
          kind: "exit",
          action: "SELL_UP",
          score: 0.3,
          triggeredBy: ["take-profit-hit"],
          requestedShares: 5,
          remainingShares: 5,
          limitPrice: 0.7,
          createdAt: 120,
          market: "btc-5m",
          marketStartMs: 100,
          marketEndMs: 200,
          priceToBeat: 100_000,
        },
        seatLastCloseTimestamp: 130,
        marketConsolidatedPnl: 7.25,
      },
    ],
  };

  const resetState = persistenceService.resetCpnlState(familyState, ["btc-5m"]);

  assert.equal(resetState.populations[0]?.marketConsolidatedPnl, 0);
  assert.equal(resetState.populations[0]?.seatPosition.action, "BUY_UP");
  assert.equal(resetState.populations[0]?.seatPendingOrder?.action, "SELL_UP");
  assert.equal(resetState.populations[0]?.seatLastCloseTimestamp, 130);
});
