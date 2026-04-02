import * as assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
        marketPaperSessionPnl: 1.25,
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
              peakTotalPnl: 5.4,
              championScore: 8.5,
              fitnessScore: 180,
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
              grossAlphaCapture: 1.25,
              netPnlPerTrade: 1.4,
              feeRatio: 0.07,
              slippageRatio: 0.01,
              noTradeDisciplineScore: 1.5,
              regimeBreakdown: [
                {
                  regime: "regime:flat|normal",
                  tradeCount: 3,
                  totalPnl: 4.2,
                  estimatedNetEvUsd: 1.1,
                },
              ],
              triggerBreakdown: [
                {
                  triggerId: "consensus-flip",
                  tradeCount: 3,
                  totalPnl: 4.2,
                  estimatedNetEvUsd: 1.1,
                },
              ],
              totalEstimatedNetEvUsd: 1.1,
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
    assert.equal(serializedState.includes('"marketPaperSessionPnl"'), false);
    assert.ok(loadedState);
    assert.equal(loadedState.populations[0]?.activeChampionQmonId, "QMON01");
    assert.equal(loadedState.populations[0]?.marketPaperSessionPnl, 0);
    assert.equal(loadedState.populations[0]?.marketConsolidatedPnl, 2.5);
    assert.equal(loadedState.populations[0]?.qmons[0]?.pendingOrder?.action, "BUY_UP");
    assert.equal(loadedState.populations[0]?.qmons[0]?.decisionHistory.length, 0);
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.totalFeesPaid, 0.33);
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.maxDrawdown, 0.2);
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.peakTotalPnl, 5.4);
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.grossAlphaCapture, 1.25);
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.regimeBreakdown?.[0]?.regime, "regime:flat|normal");
    assert.equal(loadedState.populations[0]?.qmons[0]?.metrics.triggerBreakdown?.[0]?.triggerId, "consensus-flip");
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

test("QmonPersistenceService writes a timestamped backup snapshot before runtime reset", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "qmon-persistence-"));
  const originalCwd = process.cwd();
  const persistenceService = new QmonPersistenceService(tempDir);
  const familyState = createFamilyState();

  try {
    process.chdir(tempDir);
    const backupPath = await persistenceService.backupFamilyState(familyState, 123_456);
    const backupDirEntries = await readdir(join(tempDir, "tmp", "family-state-backups"));
    const serializedBackup = await readFile(join(tempDir, "tmp", "family-state-backups", "family-state.123456.json"), "utf-8");

    assert.equal(backupPath, join("./tmp", "family-state-backups", "family-state.123456.json"));
    assert.deepEqual(backupDirEntries, ["family-state.123456.json"]);
    assert.equal(serializedBackup.includes('"globalGeneration": 5'), true);
    assert.equal(serializedBackup.includes('"marketPaperSessionPnl"'), false);
    assert.equal(serializedBackup.includes('"decisionHistory"'), true);
    assert.equal(serializedBackup.includes('"decisionHistory": []'), true);
  } finally {
    process.chdir(originalCwd);
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
  assert.equal(resetState.populations[0]?.qmons[0]?.position.action, null);
  assert.equal(resetState.populations[0]?.qmons[0]?.pendingOrder, null);
  assert.equal(resetState.populations[0]?.qmons[0]?.decisionHistory.length, 0);
  assert.equal(resetState.populations[0]?.qmons[0]?.windowTradeCount, 0);
  assert.equal(resetState.populations[0]?.qmons[0]?.paperWindowPnls.length, 2);
  assert.equal(resetState.populations[0]?.qmons[0]?.paperWindowSlippageBps.length, 2);
  assert.equal(resetState.populations[0]?.qmons[0]?.paperWindowBaselinePnl, null);
  assert.equal(resetState.populations[0]?.qmons[0]?.currentWindowStart, null);
  assert.equal(resetState.populations[0]?.qmons[0]?.currentWindowSlippageTotalBps, 0);
  assert.equal(resetState.populations[0]?.qmons[0]?.currentWindowSlippageFillCount, 0);
});

test("QmonPersistenceService clears operational runtime state even in real mode", () => {
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
        seatLastWindowStartMs: 140,
        seatLastSettledWindowStartMs: 145,
        marketConsolidatedPnl: 7.25,
        executionRuntime: {
          route: "real",
          executionState: "real-pending-exit",
          pendingIntent: {
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
          orderId: "order-123",
          submittedAt: 121,
          confirmedVenueSeat: {
            action: "BUY_UP",
            shareCount: 5,
            entryPrice: 0.42,
            enteredAt: 100,
          },
          pendingVenueOrders: [
            {
              orderId: "order-123",
              marketSlug: "btc-updown-5m-1",
              side: "sell",
              outcome: "up",
              size: 5,
              price: 0.7,
              status: "live",
              createdAt: 121,
            },
          ],
          recoveryStartedAt: 122,
          lastReconciledAt: 123,
          lastError: "live seat divergence",
          isHalted: true,
        },
      },
    ],
  };

  const resetState = persistenceService.resetCpnlState(familyState, "real");

  assert.equal(resetState.populations[0]?.marketConsolidatedPnl, 0);
  assert.equal(resetState.populations[0]?.seatPosition.action, null);
  assert.equal(resetState.populations[0]?.seatPendingOrder, null);
  assert.equal(resetState.populations[0]?.seatLastCloseTimestamp, null);
  assert.equal(resetState.populations[0]?.seatLastWindowStartMs, null);
  assert.equal(resetState.populations[0]?.seatLastSettledWindowStartMs, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.route, "real");
  assert.equal(resetState.populations[0]?.executionRuntime?.executionState, "real-armed");
  assert.equal(resetState.populations[0]?.executionRuntime?.pendingIntent, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.orderId, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.confirmedVenueSeat, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.pendingVenueOrders.length, 0);
  assert.equal(resetState.populations[0]?.executionRuntime?.recoveryStartedAt, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.lastReconciledAt, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.lastError, null);
  assert.equal(resetState.populations[0]?.executionRuntime?.isHalted, false);
});

test("QmonPersistenceService migrates legacy live execution state into the canonical population runtime", () => {
  const persistenceService = new QmonPersistenceService("/tmp/qmon-persistence");
  const familyState = createFamilyState();
  const migratedState = persistenceService.normalizeFamilyState(
    familyState,
    "real",
    {
      updatedAt: 999,
      markets: [
        {
          market: "btc-5m",
          routeState: "recovery-required",
          pendingIntentKey: "btc-5m:entry:BUY_UP:20:5.000000:0.420000",
          submittedAt: 222,
          orderId: "legacy-order-1",
          confirmedLiveSeat: {
            action: "BUY_UP",
            shareCount: 5,
            entryPrice: 0.42,
            enteredAt: 111,
          },
          lastError: "restart with unresolved live order",
        },
      ],
    },
  );

  assert.equal(migratedState.populations[0]?.executionRuntime?.route, "real");
  assert.equal(migratedState.populations[0]?.executionRuntime?.executionState, "real-recovery-required");
  assert.equal(migratedState.populations[0]?.executionRuntime?.orderId, "legacy-order-1");
  assert.equal(migratedState.populations[0]?.executionRuntime?.confirmedVenueSeat?.action, "BUY_UP");
  assert.equal(migratedState.populations[0]?.executionRuntime?.lastError, "restart with unresolved live order");
});
