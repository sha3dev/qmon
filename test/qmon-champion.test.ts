import * as assert from "node:assert/strict";
import { test } from "node:test";

import { QmonChampionService } from "../src/qmon/qmon-champion.service.ts";
import type { MarketKey, Qmon } from "../src/qmon/qmon.types.ts";

const MARKET_KEY = "btc-5m" as const satisfies MarketKey;

function createChampionCandidate(id: string, winRate: number, totalFeesPaid: number): Qmon {
  return {
    id,
    market: MARKET_KEY,
    genome: {
      predictiveSignalGenes: [],
      microstructureSignalGenes: [],
      signalGenes: [],
      triggerGenes: [],
      timeWindowGenes: [true, true, true],
      directionRegimeGenes: [true, true, true],
      volatilityRegimeGenes: [true, true, true],
      exchangeWeights: [0.25, 0.25, 0.25, 0.25],
      entryPolicy: {
        minEdgeBps: 25,
        minNetEvUsd: 0.05,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 40,
        maxSlippageBps: 50,
        minFillQuality: 0.45,
      },
      executionPolicy: {
        sizeTier: 1,
        maxTradesPerWindow: 1,
        cooldownProfile: "balanced",
      },
      exitPolicy: {
        extremeStopLossPct: 0.3,
        extremeTakeProfitPct: 0.5,
        thesisInvalidationPolicy: "hybrid",
      },
      maxTradesPerWindow: 1,
      maxSlippageBps: 50,
      minScoreBuy: 0.4,
      minScoreSell: 0.4,
      stopLossPct: 0.3,
      takeProfitPct: 0.5,
    },
    role: "candidate",
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
      totalTrades: 16,
      totalPnl: 4,
      championScore: null,
      paperWindowMedianPnl: null,
      paperWindowPnlSum: 0,
      paperLongWindowPnlSum: 0,
      negativeWindowRateLast10: 0,
      worstWindowPnlLast10: null,
      recentAvgSlippageBps: 12,
      isChampionEligible: false,
      championEligibilityReasons: [],
      totalFeesPaid,
      winRate,
      winCount: Math.round(16 * winRate),
      avgScore: 0.5,
      maxDrawdown: 0,
      lastUpdate: 1,
    },
    decisionHistory: [],
    windowTradeCount: 0,
    windowsLived: 8,
    paperWindowPnls: [0.4, 0.5, 0.45, 0.35, 0.5, 0.55],
    paperWindowSlippageBps: [10, 12, 12, 13, 11, 12],
    paperWindowBaselinePnl: null,
    currentWindowStart: 1,
    currentWindowSlippageTotalBps: 0,
    currentWindowSlippageFillCount: 0,
    lastCloseTimestamp: null,
  };
}

test("QmonChampionService penalizes costly low-conviction champions", () => {
  const championService = new QmonChampionService();
  const efficientCandidate = championService.refreshMetrics(createChampionCandidate("EFFICIENT", 0.75, 0.2));
  const costlyCandidate = championService.refreshMetrics(createChampionCandidate("COSTLY", 0.62, 1.4));

  assert.equal(efficientCandidate.metrics.isChampionEligible, true);
  assert.equal(costlyCandidate.metrics.isChampionEligible, true);
  assert.equal((efficientCandidate.metrics.championScore ?? 0) > (costlyCandidate.metrics.championScore ?? 0), true);
});

test("QmonChampionService attributes trigger breakdown only to entry triggers", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("TRIGGERED", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    decisionHistory: [
      {
        timestamp: 1,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -10,
        modelScore: 0.8,
        triggeredBy: ["book-pressure"],
        fee: 0.1,
        executionPrice: 0.4,
        entryPrice: 0.4,
        shareCount: 25,
        priceImpactBps: 0,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "normal",
        estimatedNetEvUsd: 0.6,
      },
      {
        timestamp: 2,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 12,
        modelScore: 0.8,
        triggeredBy: ["thesis-invalidated"],
        fee: 0.1,
        executionPrice: 0.48,
        entryPrice: 0.4,
        shareCount: 25,
        priceImpactBps: 0,
        isHydratedReplay: false,
        estimatedNetEvUsd: 0.6,
      },
    ],
  });
  const triggerBreakdown = refreshedQmon.metrics.triggerBreakdown ?? [];

  assert.equal(triggerBreakdown.length, 1);
  assert.equal(triggerBreakdown[0]?.triggerId, "book-pressure");
  assert.equal(triggerBreakdown[0]?.tradeCount, 1);
  assert.equal(triggerBreakdown[0]?.totalPnl, 2);
});

test("QmonChampionService attributes regime breakdown to the entry regime of completed trades", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("REGIME", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    decisionHistory: [
      {
        timestamp: 1,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -8,
        modelScore: 0.75,
        triggeredBy: ["liquidity-shift"],
        fee: 0.1,
        executionPrice: 0.4,
        entryPrice: 0.4,
        shareCount: 20,
        priceImpactBps: 0,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "high",
        estimatedNetEvUsd: 0.4,
      },
      {
        timestamp: 2,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 9.5,
        modelScore: 0.75,
        triggeredBy: ["market-settled"],
        fee: 0.1,
        executionPrice: 0.475,
        entryPrice: 0.4,
        shareCount: 20,
        priceImpactBps: 0,
        isHydratedReplay: false,
        estimatedNetEvUsd: 0.4,
      },
    ],
  });
  const regimeBreakdown = refreshedQmon.metrics.regimeBreakdown ?? [];

  assert.equal(regimeBreakdown.length, 1);
  assert.equal(regimeBreakdown[0]?.regime, "regime:flat|high");
  assert.equal(regimeBreakdown[0]?.tradeCount, 1);
  assert.equal(regimeBreakdown[0]?.totalPnl, 1.5);
});

test("QmonChampionService measures drawdown on completed trades instead of raw entry cashflow", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("DRAWDOWN", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    paperWindowPnls: [1, 1, 1, 1, 1, 1],
    decisionHistory: [
      {
        timestamp: 1,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -5,
        modelScore: 0.8,
        triggeredBy: ["book-pressure"],
        fee: 0.1,
        executionPrice: 0.5,
        entryPrice: 0.5,
        shareCount: 10,
        priceImpactBps: 0,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "normal",
        estimatedNetEvUsd: 0.5,
      },
      {
        timestamp: 2,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 5.4,
        modelScore: 0.8,
        triggeredBy: ["thesis-invalidated"],
        fee: 0.1,
        executionPrice: 0.54,
        entryPrice: 0.5,
        shareCount: 10,
        priceImpactBps: 0,
        isHydratedReplay: false,
        estimatedNetEvUsd: 0.5,
      },
      {
        timestamp: 3,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -5.2,
        modelScore: 0.75,
        triggeredBy: ["book-pressure"],
        fee: 0.1,
        executionPrice: 0.52,
        entryPrice: 0.52,
        shareCount: 10,
        priceImpactBps: 0,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "high",
        estimatedNetEvUsd: 0.45,
      },
      {
        timestamp: 4,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 5.7,
        modelScore: 0.75,
        triggeredBy: ["market-settled"],
        fee: 0.1,
        executionPrice: 0.57,
        entryPrice: 0.52,
        shareCount: 10,
        priceImpactBps: 0,
        isHydratedReplay: false,
        estimatedNetEvUsd: 0.45,
      },
    ],
  });

  assert.equal(refreshedQmon.metrics.maxDrawdown, 0);
  assert.equal(refreshedQmon.metrics.isChampionEligible, true);
});

test("QmonChampionService treats zero-trade windows as neutral in champion median checks", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("SPARSE", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    paperWindowPnls: [0, 0, 0.2, 0.3, 0.4, 0.5],
  });

  assert.equal(refreshedQmon.metrics.paperWindowMedianPnl, 0.35);
  assert.equal(refreshedQmon.metrics.isChampionEligible, true);
});

test("QmonChampionService computes fee ratio from lifetime pnl and fees", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("FEES", 0.75, 0.5182386360100615);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    metrics: {
      ...qmon.metrics,
      totalTrades: 3,
      totalPnl: -0.7359681016975683,
      totalFeesPaid: 0.5182386360100615,
      winRate: 1,
      winCount: 3,
    },
    paperWindowPnls: [2.7224064, 2.9111993483024365, 1.0704261499999976, 0.2, 0.3, 0.4],
    decisionHistory: [
      {
        timestamp: 1,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -10.855000000000002,
        modelScore: 1,
        triggeredBy: ["mispricing"],
        fee: 0.06745826181249995,
        executionPrice: 0.9045833333333334,
        entryPrice: 0.9045833333333334,
        shareCount: 11.92542615,
        priceImpactBps: 50.925925925926485,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "normal",
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5529998279539525,
        predictedSlippageBps: 5.956284255239797,
        tradeabilityRejectReason: null,
        signalAgreementCount: 3,
        dominantSignalGroup: "microstructure",
      },
      {
        timestamp: 2,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 11.92542615,
        modelScore: 1,
        triggeredBy: ["market-settled"],
        fee: 0,
        executionPrice: 1,
        entryPrice: 0.9045833333333334,
        shareCount: 11.92542615,
        priceImpactBps: null,
        isHydratedReplay: false,
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5529998279539525,
        predictedSlippageBps: 5.956284255239797,
        tradeabilityRejectReason: null,
        signalAgreementCount: 3,
        dominantSignalGroup: "microstructure",
      },
      {
        timestamp: 3,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -9.120000000000003,
        modelScore: 1,
        triggeredBy: ["mispricing"],
        fee: 0.11977113599999997,
        executionPrice: 0.7600000000000001,
        entryPrice: 0.7600000000000001,
        shareCount: 11.8424064,
        priceImpactBps: 0,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "normal",
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5530061698227058,
        predictedSlippageBps: 5.955662327487417,
        tradeabilityRejectReason: null,
        signalAgreementCount: 2,
        dominantSignalGroup: "microstructure",
      },
      {
        timestamp: 4,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 11.8424064,
        modelScore: 1,
        triggeredBy: ["market-settled"],
        fee: 0,
        executionPrice: 1,
        entryPrice: 0.7600000000000001,
        shareCount: 11.8424064,
        priceImpactBps: null,
        isHydratedReplay: false,
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5530061698227058,
        predictedSlippageBps: 5.955662327487417,
        tradeabilityRejectReason: null,
        signalAgreementCount: 2,
        dominantSignalGroup: "microstructure",
      },
      {
        timestamp: 5,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -7.39,
        modelScore: 1,
        triggeredBy: ["mispricing"],
        fee: 0.1258808905,
        executionPrice: 0.6158333333333333,
        entryPrice: 0.6158333333333333,
        shareCount: 11.795592599999999,
        priceImpactBps: 95.62841530054683,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "normal",
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5399728952936113,
        predictedSlippageBps: 5.958695761197287,
        tradeabilityRejectReason: null,
        signalAgreementCount: 2,
        dominantSignalGroup: "microstructure",
      },
      {
        timestamp: 6,
        market: MARKET_KEY,
        action: "HOLD",
        cashflow: 10.301199348302436,
        modelScore: 1,
        triggeredBy: ["take-profit-hit"],
        fee: 0.07892213969756165,
        executionPrice: 0.8799999999999999,
        entryPrice: 0.6158333333333333,
        shareCount: 11.795592599999999,
        priceImpactBps: 0,
        isHydratedReplay: false,
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5399728952936113,
        predictedSlippageBps: 5.958695761197287,
        tradeabilityRejectReason: null,
        signalAgreementCount: 2,
        dominantSignalGroup: "microstructure",
      },
      {
        timestamp: 7,
        market: MARKET_KEY,
        action: "BUY_UP",
        cashflow: -7.4399999999999995,
        modelScore: 1,
        triggeredBy: ["mispricing"],
        fee: 0.126206208,
        executionPrice: 0.62,
        entryPrice: 0.62,
        shareCount: 11.7964416,
        priceImpactBps: 0,
        isHydratedReplay: false,
        entryDirectionRegime: "flat",
        entryVolatilityRegime: "high",
        directionalAlpha: 1,
        estimatedEdgeBps: 1200,
        estimatedNetEvUsd: 0.5529807023010163,
        predictedSlippageBps: 5.958182943558036,
        tradeabilityRejectReason: null,
        signalAgreementCount: 2,
        dominantSignalGroup: "microstructure",
      },
    ],
  });

  assert.equal(Number((refreshedQmon.metrics.feeRatio ?? 0).toFixed(3)), 0.413);
});
