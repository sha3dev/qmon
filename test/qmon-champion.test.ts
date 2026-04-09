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
      beliefWeights: {
        spotOracleAlignment: 1,
        resolutionMomentum: 0.8,
        consensusPersistence: 0.9,
        microstructureStability: 0.7,
        bookFreshness: 0.6,
        marketDivergence: 0.5,
      },
      timeWindowGenes: [true, true, true],
      directionRegimeGenes: [true, true, true],
      volatilityRegimeGenes: [true, true, true],
      exchangeWeights: [0.25, 0.25, 0.25, 0.25],
      entryPolicy: {
        confidenceThreshold: 0.6,
        confirmationRequirement: 2,
        maxSpreadPenaltyBps: 40,
        maxSlippageBps: 50,
        minFillQuality: 0.45,
        uncertaintyTolerance: 0.45,
      },
      executionPolicy: {
        sizeTier: 1,
        maxTradesPerWindow: 1,
        cooldownProfile: "balanced",
      },
      exitPolicy: {
        thesisCollapseProbability: 0.4,
        extremeDrawdownPct: 0.85,
      },
      riskBudgetUsd: 1,
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
    shadowPosition: null,
    pendingOrder: null,
    metrics: {
      totalTrades: 16,
      totalPnl: 12,
      peakTotalPnl: 12,
      championScore: null,
      fitnessScore: null,
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
      grossAlphaCapture: 4,
      netPnlPerTrade: 0,
      feeRatio: 0,
      slippageRatio: 0,
      noTradeDisciplineScore: 0,
      regimeBreakdown: [
        {
          regime: "regime:flat|normal",
          tradeCount: 8,
          totalPnl: 6,
          estimatedNetEvUsd: 2,
        },
        {
          regime: "regime:trending-up|normal",
          tradeCount: 8,
          totalPnl: 6,
          estimatedNetEvUsd: 2,
        },
      ],
      triggerBreakdown: [
        {
          triggerId: "book-pressure",
          tradeCount: 16,
          totalPnl: 12,
          estimatedNetEvUsd: 4,
        },
      ],
      totalEstimatedNetEvUsd: 4,
      shadowResolvedCount: 0,
      shadowCorrectCount: 0,
      shadowBrierScoreSum: 0,
      shadowNetPnl: 0,
      lastUpdate: 1,
    },
    decisionHistory: [],
    windowTradeCount: 0,
    windowsLived: 8,
    paperWindowPnls: [0.5, 0.55, 0.6, 0.5, 0.55, 0.65],
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

test("QmonChampionService preserves persisted trigger breakdown when decision history is empty", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("TRIGGERED", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics(qmon);
  const triggerBreakdown = refreshedQmon.metrics.triggerBreakdown ?? [];

  assert.equal(triggerBreakdown.length, 1);
  assert.equal(triggerBreakdown[0]?.triggerId, "book-pressure");
  assert.equal(triggerBreakdown[0]?.tradeCount, 16);
  assert.equal(triggerBreakdown[0]?.totalPnl, 12);
});

test("QmonChampionService preserves persisted regime breakdown when decision history is empty", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("REGIME", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics(qmon);
  const regimeBreakdown = refreshedQmon.metrics.regimeBreakdown ?? [];

  assert.equal(regimeBreakdown.length, 2);
  assert.equal(regimeBreakdown[0]?.regime, "regime:flat|normal");
  assert.equal(regimeBreakdown[0]?.tradeCount, 8);
  assert.equal(regimeBreakdown[0]?.totalPnl, 6);
});

test("QmonChampionService uses persisted drawdown and remains evaluable after decision history reset", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("DRAWDOWN", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    paperWindowPnls: [1, 1, 1, 1, 1, 1],
    decisionHistory: [],
    metrics: {
      ...qmon.metrics,
      maxDrawdown: 1.7,
    },
  });

  assert.equal(refreshedQmon.metrics.maxDrawdown, 1.7);
  assert.equal(refreshedQmon.metrics.isChampionEligible, true);
});

test("QmonChampionService ignores zero-trade windows in champion median checks", () => {
  const championService = new QmonChampionService();
  const qmon = createChampionCandidate("SPARSE", 0.7, 0.2);
  const refreshedQmon = championService.refreshMetrics({
    ...qmon,
    paperWindowPnls: [0, 0, 0.2, 0.3, 0.4, 0.5],
  });

  assert.equal(refreshedQmon.metrics.paperWindowMedianPnl, 0.35);
  assert.equal(refreshedQmon.metrics.isChampionEligible, false);
  assert.equal(refreshedQmon.metrics.championEligibilityReasons.includes("non-positive-median"), true);
});

test("QmonChampionService evaluates negative window rate and worst window over ten windows", () => {
  const championService = new QmonChampionService();
  const refreshedQmon = championService.refreshMetrics({
    ...createChampionCandidate("RISK10", 0.8, 0.2),
    paperWindowPnls: [-3, -3, -3, -3, -3, 2, 2, 2, 2, 2],
  });

  assert.equal(refreshedQmon.metrics.negativeWindowRateLast10, 0.5);
  assert.equal(refreshedQmon.metrics.worstWindowPnlLast10, -3);
  assert.equal(refreshedQmon.metrics.isChampionEligible, false);
  assert.equal(refreshedQmon.metrics.championEligibilityReasons.includes("high-negative-window-rate"), true);
}
);

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

test("QmonChampionService blocks overexposed overtrading candidates without enough edge per trade", () => {
  const championService = new QmonChampionService();
  const refreshedQmon = championService.refreshMetrics({
    ...createChampionCandidate("OVERTRADE", 0.58, 0.2),
    windowsLived: 4,
    metrics: {
      ...createChampionCandidate("OVERTRADE", 0.58, 0.2).metrics,
      totalTrades: 8,
      totalPnl: 0.4,
      winRate: 0.58,
      winCount: 5,
      observedTicks: 100,
      positionHoldTicks: 95,
      marketExposureRatio: 0.95,
      tradesPerWindow: 2,
    },
    paperWindowPnls: [0.1, 0.1, 0.1, 0.05, 0.05],
  });

  assert.equal(refreshedQmon.metrics.isChampionEligible, false);
  assert.equal(refreshedQmon.metrics.championEligibilityReasons.includes("overexposed-without-edge"), true);
  assert.equal(refreshedQmon.metrics.championEligibilityReasons.includes("overtrading-without-edge"), true);
});

test("QmonChampionService rejects candidates with strong lifetime pnl but recent deterioration", () => {
  const championService = new QmonChampionService();
  const deterioratingQmon = championService.refreshMetrics({
    ...createChampionCandidate("RECENTDOWN", 0.8, 0.2),
    paperWindowPnls: [2, 2, 2, -1, -1, -1],
  });

  assert.equal(deterioratingQmon.metrics.isChampionEligible, false);
  assert.equal(deterioratingQmon.metrics.championEligibilityReasons.includes("non-positive-median"), true);
});

test("QmonChampionService rejects high-pnl candidates with too few trades", () => {
  const championService = new QmonChampionService();
  const lowSampleQmon = championService.refreshMetrics({
    ...createChampionCandidate("FEWSAMPLE", 1, 0.1),
    metrics: {
      ...createChampionCandidate("FEWSAMPLE", 1, 0.1).metrics,
      totalTrades: 4,
      winCount: 4,
      totalPnl: 18,
      peakTotalPnl: 18,
    },
  });

  assert.equal(lowSampleQmon.metrics.isChampionEligible, false);
  assert.equal(lowSampleQmon.metrics.championEligibilityReasons.includes("insufficient-trades"), true);
});

test("QmonChampionService allows validated shadow evidence to satisfy sparse-history gates", () => {
  const championService = new QmonChampionService();
  const shadowValidatedQmon = championService.refreshMetrics({
    ...createChampionCandidate("SHADOWPASS", 1, 0.1),
    metrics: {
      ...createChampionCandidate("SHADOWPASS", 1, 0.1).metrics,
      totalTrades: 3,
      winCount: 3,
      winRate: 1,
      totalPnl: 18,
      peakTotalPnl: 18,
      shadowResolvedCount: 30,
      shadowCorrectCount: 19,
      shadowBrierScoreSum: 5.4,
      shadowNetPnl: 12,
    },
    paperWindowPnls: [],
  });

  assert.equal(shadowValidatedQmon.metrics.isChampionEligible, true);
  assert.equal(shadowValidatedQmon.metrics.championEligibilityReasons.includes("insufficient-trades"), false);
  assert.equal(shadowValidatedQmon.metrics.championEligibilityReasons.includes("non-positive-sum"), false);
  assert.equal(shadowValidatedQmon.metrics.championEligibilityReasons.includes("fails-out-of-sample-validation"), false);
});

test("QmonChampionService keeps sparse-history gates when shadow evidence is too weak", () => {
  const championService = new QmonChampionService();
  const weakShadowQmon = championService.refreshMetrics({
    ...createChampionCandidate("SHADOWFAIL", 1, 0.1),
    metrics: {
      ...createChampionCandidate("SHADOWFAIL", 1, 0.1).metrics,
      totalTrades: 3,
      winCount: 3,
      winRate: 1,
      totalPnl: 18,
      peakTotalPnl: 18,
      shadowResolvedCount: 12,
      shadowCorrectCount: 7,
      shadowBrierScoreSum: 3.6,
      shadowNetPnl: 4,
    },
    paperWindowPnls: [],
  });

  assert.equal(weakShadowQmon.metrics.isChampionEligible, false);
  assert.equal(weakShadowQmon.metrics.championEligibilityReasons.includes("insufficient-trades"), true);
  assert.equal(weakShadowQmon.metrics.championEligibilityReasons.includes("non-positive-sum"), true);
  assert.equal(weakShadowQmon.metrics.championEligibilityReasons.includes("fails-out-of-sample-validation"), true);
});

test("QmonChampionService migrates production-readiness checks into champion eligibility", () => {
  const championService = new QmonChampionService();
  const slippageBlockedQmon = championService.refreshMetrics({
    ...createChampionCandidate("SLIPPAGE", 0.8, 0.4),
    paperWindowSlippageBps: [120, 118, 122, 121, 119, 120],
    metrics: {
      ...createChampionCandidate("SLIPPAGE", 0.8, 0.4).metrics,
      recentAvgSlippageBps: 120,
    },
  });
  const expensiveQmon = championService.refreshMetrics({
    ...createChampionCandidate("EXPENSIVE", 0.8, 25),
    metrics: {
      ...createChampionCandidate("EXPENSIVE", 0.8, 25).metrics,
      maxDrawdown: 6,
      totalFeesPaid: 25,
    },
  });

  assert.equal(slippageBlockedQmon.metrics.isChampionEligible, false);
  assert.equal(slippageBlockedQmon.metrics.championEligibilityReasons.includes("high-slippage"), true);
  assert.equal(expensiveQmon.metrics.isChampionEligible, false);
  assert.equal(expensiveQmon.metrics.championEligibilityReasons.includes("high-fee-ratio"), true);
  assert.equal(expensiveQmon.metrics.championEligibilityReasons.includes("high-drawdown"), true);
});

test("QmonChampionService caps estimated EV contribution in fitness", () => {
  const championService = new QmonChampionService();
  const realisticEvQmon = championService.refreshMetrics({
    ...createChampionCandidate("RELEV", 0.8, 0.2),
    metrics: {
      ...createChampionCandidate("RELEV", 0.8, 0.2).metrics,
      totalEstimatedNetEvUsd: 10,
    },
  });
  const inflatedEvQmon = championService.refreshMetrics({
    ...createChampionCandidate("HIGHEV", 0.8, 0.2),
    metrics: {
      ...createChampionCandidate("HIGHEV", 0.8, 0.2).metrics,
      totalEstimatedNetEvUsd: 10_000,
    },
  });

  assert.equal(
    Number(((inflatedEvQmon.metrics.fitnessScore ?? 0) - (realisticEvQmon.metrics.fitnessScore ?? 0)).toFixed(2)),
    2.5,
  );
});

test("QmonChampionService uses shadow evidence to rank equally realized candidates", () => {
  const championService = new QmonChampionService();
  const baselineQmon = championService.refreshMetrics(createChampionCandidate("BASELINE", 0.75, 0.2));
  const shadowQmon = championService.refreshMetrics({
    ...createChampionCandidate("SHADOW01", 0.75, 0.2),
    metrics: {
      ...createChampionCandidate("SHADOW01", 0.75, 0.2).metrics,
      shadowResolvedCount: 12,
      shadowCorrectCount: 9,
      shadowBrierScoreSum: 1.2,
      shadowNetPnl: 6,
    },
  });

  assert.equal((shadowQmon.metrics.fitnessScore ?? 0) > (baselineQmon.metrics.fitnessScore ?? 0), true);
});

test("QmonChampionService prefers recently active champions over equally strong idle ones", () => {
  const championService = new QmonChampionService();
  const activeQmon = championService.refreshMetrics({
    ...createChampionCandidate("ACTIVE01", 0.75, 0.2),
    paperWindowPnls: [0.6, 0.55, 0.7, 0, 0, 0.65],
  });
  const idleQmon = championService.refreshMetrics({
    ...createChampionCandidate("IDLEALT1", 0.75, 0.2),
    paperWindowPnls: [0.6, 0.55, 0.7, 0, 0, 0],
  });

  assert.equal(activeQmon.metrics.isChampionEligible, true);
  assert.equal(idleQmon.metrics.isChampionEligible, true);
  assert.equal((activeQmon.metrics.championScore ?? 0) > (idleQmon.metrics.championScore ?? 0), true);
});

test("QmonChampionService selects the best eligible champion by the new score priority", () => {
  const championService = new QmonChampionService();
  const steadyQmon = championService.refreshMetrics({
    ...createChampionCandidate("STEADY01", 0.78, 0.25),
    paperWindowPnls: [0.8, 0.9, 0.85, 0.95, 0.9, 0.92],
  });
  const noisyQmon = championService.refreshMetrics({
    ...createChampionCandidate("NOISY01", 0.78, 0.25),
    metrics: {
      ...createChampionCandidate("NOISY01", 0.78, 0.25).metrics,
      totalPnl: 13,
      peakTotalPnl: 13,
      maxDrawdown: 4.5,
    },
    paperWindowPnls: [1.7, 0.1, 1.6, 0.1, 1.7, 0.1],
  });
  const finalizedPopulation = championService.finalizePopulation(
    {
      market: MARKET_KEY,
      qmons: [steadyQmon, noisyQmon],
      createdAt: 1,
      lastUpdated: 1,
      activeChampionQmonId: null,
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
      seatLastWindowStartMs: 1,
      seatLastSettledWindowStartMs: null,
    },
    [steadyQmon, noisyQmon],
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
  );

  assert.equal(finalizedPopulation.activeChampionQmonId, "STEADY01");
});

test("QmonChampionService leaves the seat without champion when strict eligibility rejects every candidate", () => {
  const championService = new QmonChampionService();
  const fallbackQmon = championService.refreshMetrics({
    ...createChampionCandidate("FALLBACK", 0.7, 0.2),
    metrics: {
      ...createChampionCandidate("FALLBACK", 0.7, 0.2).metrics,
      totalTrades: 4,
      totalPnl: 2,
      peakTotalPnl: 2,
      winRate: 0.75,
      winCount: 3,
    },
    paperWindowPnls: [0.3, 0.4],
  });
  const weakQmon = championService.refreshMetrics({
    ...createChampionCandidate("WEAKSEAT", 0.4, 1.2),
    metrics: {
      ...createChampionCandidate("WEAKSEAT", 0.4, 1.2).metrics,
      totalTrades: 4,
      totalPnl: -1,
      peakTotalPnl: 0,
      winRate: 0.25,
      winCount: 1,
    },
    paperWindowPnls: [-0.2, -0.3],
  });
  const finalizedPopulation = championService.finalizePopulation(
    {
      market: MARKET_KEY,
      qmons: [fallbackQmon, weakQmon],
      createdAt: 1,
      lastUpdated: 1,
      activeChampionQmonId: null,
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
      seatLastWindowStartMs: 1,
      seatLastSettledWindowStartMs: null,
    },
    [fallbackQmon, weakQmon],
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
  );

  assert.equal(fallbackQmon.metrics.isChampionEligible, false);
  assert.equal(weakQmon.metrics.isChampionEligible, false);
  assert.equal(finalizedPopulation.activeChampionQmonId, null);
});

test("QmonChampionService keeps a healthy idle incumbent when no replacement is strictly eligible", () => {
  const championService = new QmonChampionService();
  const incumbentChampion = championService.refreshMetrics({
    ...createChampionCandidate("INCUMBENT", 0.7, 0.2),
    role: "champion",
    paperWindowPnls: [0.8, 0.7, 0.6, 0, 0],
  });
  const weakQmon = championService.refreshMetrics({
    ...createChampionCandidate("WEAKSEAT", 0.4, 1.2),
    metrics: {
      ...createChampionCandidate("WEAKSEAT", 0.4, 1.2).metrics,
      totalTrades: 16,
      totalPnl: -1,
      peakTotalPnl: 0,
      winRate: 0.4,
      winCount: 6,
    },
    paperWindowPnls: [-0.2, -0.3, 0, 0, 0],
  });
  const finalizedPopulation = championService.finalizePopulation(
    {
      market: MARKET_KEY,
      qmons: [incumbentChampion, weakQmon],
      createdAt: 1,
      lastUpdated: 1,
      activeChampionQmonId: "INCUMBENT",
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
      seatLastWindowStartMs: 1,
      seatLastSettledWindowStartMs: null,
    },
    [incumbentChampion, weakQmon],
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
  );

  assert.equal(finalizedPopulation.activeChampionQmonId, "INCUMBENT");
});

test("QmonChampionService drops an incumbent that stays fully idle across recent windows", () => {
  const championService = new QmonChampionService();
  const idleChampion = championService.refreshMetrics({
    ...createChampionCandidate("IDLE001", 0.7, 0.2),
    role: "champion",
    paperWindowPnls: [0, 0, 0, 0, 0],
  });
  const finalizedPopulation = championService.finalizePopulation(
    {
      market: MARKET_KEY,
      qmons: [idleChampion],
      createdAt: 1,
      lastUpdated: 1,
      activeChampionQmonId: "IDLE001",
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
      seatLastWindowStartMs: 1,
      seatLastSettledWindowStartMs: null,
    },
    [idleChampion],
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
  );

  assert.equal(finalizedPopulation.activeChampionQmonId, null);
});
