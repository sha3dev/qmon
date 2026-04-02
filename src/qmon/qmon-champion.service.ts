/**
 * @section imports:internals
 */

import type { Qmon, QmonPopulation, QmonPosition, QmonRole, RegimePerformanceSlice, TriggerPerformanceSlice } from "./qmon.types.ts";

/**
 * @section consts
 */

const PAPER_CHAMPION_HISTORY_WINDOW = 5;
const PAPER_CHAMPION_LONG_HISTORY_WINDOW = 30;
const CHAMPION_MIN_WIN_RATE = 0.55;
const CHAMPION_MAX_NEGATIVE_WINDOW_RATE = 0.4;
const CHAMPION_MAX_FEE_RATIO = 0.65;
const CHAMPION_MAX_DRAWDOWN = 10;
const CHAMPION_MIN_REGIME_COVERAGE = 2;

type ChampionInputs = {
  readonly championScore: number | null;
  readonly fitnessScore: number | null;
  readonly paperWindowMedianPnl: number | null;
  readonly paperWindowPnlSum: number;
  readonly paperLongWindowPnlSum: number;
  readonly negativeWindowRateLast10: number;
  readonly worstWindowPnlLast10: number | null;
  readonly recentAvgSlippageBps: number;
  readonly netPnlPerTrade: number;
  readonly feeRatio: number;
  readonly slippageRatio: number;
  readonly grossAlphaCapture: number;
  readonly noTradeDisciplineScore: number;
  readonly regimeBreakdown: readonly RegimePerformanceSlice[];
  readonly triggerBreakdown: readonly TriggerPerformanceSlice[];
  readonly maxDrawdown: number;
  readonly isChampionEligible: boolean;
  readonly championEligibilityReasons: readonly string[];
};

type CompletedTradeSummary = {
  readonly entryDecision: Qmon["decisionHistory"][number];
  readonly totalPnl: number;
  readonly estimatedNetEvUsd: number;
};

/**
 * @section class
 */

export class QmonChampionService {
  /**
   * @section public:methods
   */

  public refreshMetrics(qmon: Qmon): Qmon {
    const championInputs = this.buildChampionInputs(qmon);
    const refreshedQmon: Qmon = {
      ...qmon,
      metrics: {
        ...qmon.metrics,
        championScore: championInputs.championScore,
        fitnessScore: championInputs.fitnessScore,
        paperWindowMedianPnl: championInputs.paperWindowMedianPnl,
        paperWindowPnlSum: championInputs.paperWindowPnlSum,
        paperLongWindowPnlSum: championInputs.paperLongWindowPnlSum,
        negativeWindowRateLast10: championInputs.negativeWindowRateLast10,
        worstWindowPnlLast10: championInputs.worstWindowPnlLast10,
        recentAvgSlippageBps: championInputs.recentAvgSlippageBps,
        netPnlPerTrade: championInputs.netPnlPerTrade,
        feeRatio: championInputs.feeRatio,
        slippageRatio: championInputs.slippageRatio,
        grossAlphaCapture: championInputs.grossAlphaCapture,
        noTradeDisciplineScore: championInputs.noTradeDisciplineScore,
        regimeBreakdown: championInputs.regimeBreakdown,
        triggerBreakdown: championInputs.triggerBreakdown,
        maxDrawdown: championInputs.maxDrawdown,
        isChampionEligible: championInputs.isChampionEligible,
        championEligibilityReasons: championInputs.championEligibilityReasons,
      },
    };

    return refreshedQmon;
  }

  public appendPaperWindowPnl(qmon: Qmon, paperWindowPnl: number): Qmon {
    const updatedPaperWindowPnls = [...qmon.paperWindowPnls, paperWindowPnl].slice(-PAPER_CHAMPION_LONG_HISTORY_WINDOW);
    const completedWindowSlippageBps = qmon.currentWindowSlippageFillCount > 0 ? qmon.currentWindowSlippageTotalBps / qmon.currentWindowSlippageFillCount : 0;
    const updatedPaperWindowSlippageBps = [...qmon.paperWindowSlippageBps, completedWindowSlippageBps].slice(-PAPER_CHAMPION_LONG_HISTORY_WINDOW);
    const updatedQmon = this.refreshMetrics({
      ...qmon,
      paperWindowPnls: updatedPaperWindowPnls,
      paperWindowSlippageBps: updatedPaperWindowSlippageBps,
      paperWindowBaselinePnl: qmon.metrics.totalPnl,
      currentWindowSlippageTotalBps: 0,
      currentWindowSlippageFillCount: 0,
    });

    return updatedQmon;
  }

  public finalizePopulation(
    population: QmonPopulation,
    qmons: readonly Qmon[],
    emptyPosition: QmonPosition,
    shouldPreserveSeatState = false,
  ): QmonPopulation {
    const finalizedPaperQmons = this.finalizePaperWindowHistory(qmons);
    const preservedChampion =
      population.activeChampionQmonId !== null ? (finalizedPaperQmons.find((qmon) => qmon.id === population.activeChampionQmonId) ?? null) : null;
    const selectedChampion = shouldPreserveSeatState ? preservedChampion : this.selectActiveChampion(finalizedPaperQmons);
    const activeChampionQmonId = selectedChampion?.id ?? null;
    const qmonsWithRoles = this.applyChampionRoles(finalizedPaperQmons, activeChampionQmonId);
    const nextWindowStartMs = qmonsWithRoles[0]?.currentWindowStart ?? population.seatLastWindowStartMs;
    const finalizedPopulation: QmonPopulation = {
      ...population,
      qmons: qmonsWithRoles,
      activeChampionQmonId,
      seatPosition: shouldPreserveSeatState ? population.seatPosition : emptyPosition,
      seatPendingOrder: shouldPreserveSeatState ? population.seatPendingOrder : null,
      seatLastCloseTimestamp: shouldPreserveSeatState ? population.seatLastCloseTimestamp : null,
      seatLastWindowStartMs: nextWindowStartMs,
    };

    return finalizedPopulation;
  }

  /**
   * @section private:methods
   */

  private getRecentChampionWindowPnls(paperWindowPnls: readonly number[]): readonly number[] {
    const recentPaperWindowPnls = paperWindowPnls.slice(-PAPER_CHAMPION_HISTORY_WINDOW);

    return recentPaperWindowPnls;
  }

  private getRecentActiveChampionWindowPnls(paperWindowPnls: readonly number[]): readonly number[] {
    const recentActivePaperWindowPnls = this.getRecentChampionWindowPnls(paperWindowPnls).filter((paperWindowPnl) => paperWindowPnl !== 0);

    return recentActivePaperWindowPnls;
  }

  private getRecentChampionWindowSlippage(paperWindowSlippageBps: readonly number[]): readonly number[] {
    const recentPaperWindowSlippageBps = paperWindowSlippageBps.slice(-PAPER_CHAMPION_HISTORY_WINDOW);

    return recentPaperWindowSlippageBps;
  }

  private calculatePaperWindowMedianPnl(paperWindowPnls: readonly number[]): number | null {
    const recentPaperWindowPnls = this.getRecentActiveChampionWindowPnls(paperWindowPnls);
    let paperWindowMedianPnl: number | null = null;

    if (recentPaperWindowPnls.length > 0) {
      const sortedPnls = [...recentPaperWindowPnls].sort((leftPnl, rightPnl) => leftPnl - rightPnl);
      const middleIndex = Math.floor(sortedPnls.length / 2);
      paperWindowMedianPnl =
        sortedPnls.length % 2 === 0 ? ((sortedPnls[middleIndex - 1] ?? 0) + (sortedPnls[middleIndex] ?? 0)) / 2 : (sortedPnls[middleIndex] ?? 0);
    }

    return paperWindowMedianPnl;
  }

  private calculatePaperWindowPnlSum(paperWindowPnls: readonly number[]): number {
    const paperWindowPnlSum = this.getRecentChampionWindowPnls(paperWindowPnls).reduce((totalPnl, paperWindowPnl) => totalPnl + paperWindowPnl, 0);

    return paperWindowPnlSum;
  }

  private calculatePaperLongWindowPnlSum(paperWindowPnls: readonly number[]): number {
    const paperLongWindowPnlSum = paperWindowPnls.reduce((totalPnl, paperWindowPnl) => totalPnl + paperWindowPnl, 0);

    return paperLongWindowPnlSum;
  }

  private calculateNegativeWindowRateLast10(paperWindowPnls: readonly number[]): number {
    const recentPaperWindowPnls = this.getRecentChampionWindowPnls(paperWindowPnls);
    let negativeWindowRateLast10 = 0;

    if (recentPaperWindowPnls.length > 0) {
      negativeWindowRateLast10 = recentPaperWindowPnls.filter((paperWindowPnl) => paperWindowPnl < 0).length / recentPaperWindowPnls.length;
    }

    return negativeWindowRateLast10;
  }

  private calculateWorstWindowPnlLast10(paperWindowPnls: readonly number[]): number | null {
    const recentPaperWindowPnls = this.getRecentChampionWindowPnls(paperWindowPnls);
    const worstWindowPnlLast10 = recentPaperWindowPnls.length > 0 ? Math.min(...recentPaperWindowPnls) : null;

    return worstWindowPnlLast10;
  }

  private calculateRecentAvgSlippageBps(paperWindowSlippageBps: readonly number[]): number {
    const recentPaperWindowSlippageBps = this.getRecentChampionWindowSlippage(paperWindowSlippageBps);
    let recentAvgSlippageBps = 0;

    if (recentPaperWindowSlippageBps.length > 0) {
      recentAvgSlippageBps = recentPaperWindowSlippageBps.reduce((totalBps, slippageBps) => totalBps + slippageBps, 0) / recentPaperWindowSlippageBps.length;
    }

    return recentAvgSlippageBps;
  }

  private calculateNetPnlPerTrade(qmon: Qmon): number {
    const netPnlPerTrade = qmon.metrics.totalTrades > 0 ? qmon.metrics.totalPnl / qmon.metrics.totalTrades : 0;

    return netPnlPerTrade;
  }

  private calculateRealizedTradePnl(qmon: Qmon): number {
    const realizedTradePnl = this.buildCompletedTrades(qmon).reduce((totalPnl, completedTrade) => totalPnl + completedTrade.totalPnl, 0);

    return realizedTradePnl;
  }

  private calculateFeeRatio(qmon: Qmon): number {
    const lifetimeNetPnl = qmon.metrics.totalPnl;
    const grossPnlMagnitude = Math.max(Math.abs(lifetimeNetPnl) + qmon.metrics.totalFeesPaid, Number.EPSILON);
    const feeRatio = qmon.metrics.totalFeesPaid / grossPnlMagnitude;

    return feeRatio;
  }

  private calculateSlippageRatio(qmon: Qmon): number {
    const grossAlphaCapture = qmon.metrics.grossAlphaCapture ?? 0;
    const slippageRatio = grossAlphaCapture > 0 ? qmon.metrics.recentAvgSlippageBps / Math.max(grossAlphaCapture * 10_000, 1) : 0;

    return slippageRatio;
  }

  private calculateGrossAlphaCapture(qmon: Qmon): number {
    const grossAlphaCapture = qmon.decisionHistory.reduce((totalCapture, decision) => totalCapture + Math.max(decision.estimatedNetEvUsd ?? 0, 0), 0);

    return grossAlphaCapture;
  }

  private calculateMaxDrawdown(qmon: Qmon): number {
    let runningPnl = 0;
    let peakPnl = 0;
    let maxDrawdown = 0;

    for (const completedTrade of this.buildCompletedTrades(qmon)) {
      runningPnl += completedTrade.totalPnl;
      peakPnl = Math.max(peakPnl, runningPnl);
      maxDrawdown = Math.max(maxDrawdown, peakPnl - runningPnl);
    }

    return maxDrawdown;
  }

  private buildCompletedTrades(qmon: Qmon): readonly CompletedTradeSummary[] {
    const completedTrades: CompletedTradeSummary[] = [];
    let currentEntryDecision: Qmon["decisionHistory"][number] | null = null;
    let currentTradePnl = 0;

    for (const decision of qmon.decisionHistory) {
      if (decision.action === "BUY_UP" || decision.action === "BUY_DOWN") {
        if (currentEntryDecision !== null) {
          completedTrades.push({
            entryDecision: currentEntryDecision,
            totalPnl: currentTradePnl,
            estimatedNetEvUsd: currentEntryDecision.estimatedNetEvUsd ?? 0,
          });
        }

        currentEntryDecision = decision;
        currentTradePnl = decision.cashflow;
      } else if (decision.action === "HOLD" && currentEntryDecision !== null) {
        currentTradePnl += decision.cashflow;
        completedTrades.push({
          entryDecision: currentEntryDecision,
          totalPnl: currentTradePnl,
          estimatedNetEvUsd: currentEntryDecision.estimatedNetEvUsd ?? 0,
        });
        currentEntryDecision = null;
        currentTradePnl = 0;
      }
    }

    return completedTrades;
  }

  private buildRegimeBreakdown(qmon: Qmon): readonly RegimePerformanceSlice[] {
    const regimeAccumulator = new Map<string, { tradeCount: number; totalPnl: number; estimatedNetEvUsd: number }>();

    for (const completedTrade of this.buildCompletedTrades(qmon)) {
      const directionRegime = completedTrade.entryDecision.entryDirectionRegime ?? "unknown-direction";
      const volatilityRegime = completedTrade.entryDecision.entryVolatilityRegime ?? "unknown-volatility";
      const regimeKey = `regime:${directionRegime}|${volatilityRegime}`;
      const regimeState = regimeAccumulator.get(regimeKey) ?? { tradeCount: 0, totalPnl: 0, estimatedNetEvUsd: 0 };
      regimeAccumulator.set(regimeKey, {
        tradeCount: regimeState.tradeCount + 1,
        totalPnl: regimeState.totalPnl + completedTrade.totalPnl,
        estimatedNetEvUsd: regimeState.estimatedNetEvUsd + completedTrade.estimatedNetEvUsd,
      });
    }

    return [...regimeAccumulator.entries()].map(([regime, regimeState]) => ({
      regime,
      tradeCount: regimeState.tradeCount,
      totalPnl: regimeState.totalPnl,
      estimatedNetEvUsd: regimeState.estimatedNetEvUsd,
    }));
  }

  private buildTriggerBreakdown(qmon: Qmon): readonly TriggerPerformanceSlice[] {
    const triggerAccumulator = new Map<string, { tradeCount: number; totalPnl: number; estimatedNetEvUsd: number }>();

    for (const completedTrade of this.buildCompletedTrades(qmon)) {
      for (const triggerId of completedTrade.entryDecision.triggeredBy) {
        if (!triggerId.startsWith("regime:")) {
          const triggerState = triggerAccumulator.get(triggerId) ?? { tradeCount: 0, totalPnl: 0, estimatedNetEvUsd: 0 };
          triggerAccumulator.set(triggerId, {
            tradeCount: triggerState.tradeCount + 1,
            totalPnl: triggerState.totalPnl + completedTrade.totalPnl,
            estimatedNetEvUsd: triggerState.estimatedNetEvUsd + completedTrade.estimatedNetEvUsd,
          });
        }
      }
    }

    return [...triggerAccumulator.entries()].map(([triggerId, triggerState]) => ({
      triggerId,
      tradeCount: triggerState.tradeCount,
      totalPnl: triggerState.totalPnl,
      estimatedNetEvUsd: triggerState.estimatedNetEvUsd,
    }));
  }

  private calculateNoTradeDisciplineScore(qmon: Qmon): number {
    const windowCount = Math.max(qmon.windowsLived, 1);
    const tradeDensity = qmon.metrics.totalTrades / windowCount;
    const positiveNetPnl = Math.max(qmon.metrics.totalPnl, 0);
    const noTradeDisciplineScore = Math.max(0, 1.2 - tradeDensity * 0.2) + Math.min(1, positiveNetPnl / 5);

    return noTradeDisciplineScore;
  }

  private hasConsistentTradeState(qmon: Qmon): boolean {
    const hasOpenPosition = qmon.position.action !== null;
    const hasPositionFields = qmon.position.enteredAt !== null || qmon.position.entryPrice !== null || qmon.position.shareCount !== null;
    let isTradeStateConsistent = true;

    if (!hasOpenPosition && hasPositionFields) {
      isTradeStateConsistent = false;
    } else if (hasOpenPosition) {
      isTradeStateConsistent =
        qmon.position.enteredAt !== null && qmon.position.entryPrice !== null && qmon.position.shareCount !== null && qmon.position.shareCount > 0;
    }

    if (isTradeStateConsistent && qmon.pendingOrder !== null) {
      if (qmon.pendingOrder.kind === "entry" && hasOpenPosition) {
        isTradeStateConsistent = false;
      } else if (qmon.pendingOrder.kind === "exit" && !hasOpenPosition) {
        isTradeStateConsistent = false;
      }
    }

    return isTradeStateConsistent;
  }

  private buildChampionInputs(qmon: Qmon): ChampionInputs {
    const paperWindowPnlSum = this.calculatePaperWindowPnlSum(qmon.paperWindowPnls);
    const paperLongWindowPnlSum = this.calculatePaperLongWindowPnlSum(qmon.paperWindowPnls);
    const paperWindowMedianPnl = this.calculatePaperWindowMedianPnl(qmon.paperWindowPnls);
    const negativeWindowRateLast10 = this.calculateNegativeWindowRateLast10(qmon.paperWindowPnls);
    const worstWindowPnlLast10 = this.calculateWorstWindowPnlLast10(qmon.paperWindowPnls);
    const recentAvgSlippageBps = this.calculateRecentAvgSlippageBps(qmon.paperWindowSlippageBps);
    const netPnlPerTrade = this.calculateNetPnlPerTrade(qmon);
    const grossAlphaCapture = this.calculateGrossAlphaCapture(qmon);
    const feeRatio = this.calculateFeeRatio(qmon);
    const slippageRatio = this.calculateSlippageRatio({
      ...qmon,
      metrics: {
        ...qmon.metrics,
        grossAlphaCapture,
      },
    });
    const regimeBreakdown = this.buildRegimeBreakdown(qmon);
    const triggerBreakdown = this.buildTriggerBreakdown(qmon);
    const maxDrawdown = this.calculateMaxDrawdown(qmon);
    const noTradeDisciplineScore = this.calculateNoTradeDisciplineScore(qmon);
    const positiveRegimeCount = regimeBreakdown.filter((regimeSlice) => regimeSlice.tradeCount > 0 && regimeSlice.totalPnl >= 0).length;
    const championEligibilityReasons: string[] = [];

    if (qmon.lifecycle !== "active") {
      championEligibilityReasons.push("inactive");
    }
    if (qmon.paperWindowPnls.length < PAPER_CHAMPION_HISTORY_WINDOW) {
      championEligibilityReasons.push("insufficient-windows");
    }
    if (paperWindowPnlSum <= 0) {
      championEligibilityReasons.push("non-positive-sum");
    }
    if ((paperWindowMedianPnl ?? 0) <= 0) {
      championEligibilityReasons.push("non-positive-median");
    }
    if (qmon.metrics.totalPnl <= 0) {
      championEligibilityReasons.push("non-positive-pnl");
    }
    if (qmon.metrics.winRate < CHAMPION_MIN_WIN_RATE) {
      championEligibilityReasons.push("low-win-rate");
    }
    if (qmon.metrics.totalTrades < 10) {
      championEligibilityReasons.push("insufficient-trades");
    }
    if (paperLongWindowPnlSum <= 0) {
      championEligibilityReasons.push("non-positive-long-window-sum");
    }
    if (negativeWindowRateLast10 > CHAMPION_MAX_NEGATIVE_WINDOW_RATE) {
      championEligibilityReasons.push("high-negative-window-rate");
    }
    if (feeRatio > CHAMPION_MAX_FEE_RATIO) {
      championEligibilityReasons.push("high-fee-ratio");
    }
    if (maxDrawdown > CHAMPION_MAX_DRAWDOWN) {
      championEligibilityReasons.push("high-drawdown");
    }
    if (positiveRegimeCount < CHAMPION_MIN_REGIME_COVERAGE && regimeBreakdown.length >= CHAMPION_MIN_REGIME_COVERAGE) {
      championEligibilityReasons.push("weak-regime-coverage");
    }
    if (!this.hasConsistentTradeState(qmon)) {
      championEligibilityReasons.push("inconsistent-state");
    }

    const isChampionEligible = championEligibilityReasons.length === 0;
    const robustnessBonus = positiveRegimeCount * 35 + noTradeDisciplineScore * 40;
    const frictionPenalty = feeRatio * 250 + slippageRatio * 120 + recentAvgSlippageBps / 10;
    const instabilityPenalty = negativeWindowRateLast10 * 180 + Math.max(0, -(worstWindowPnlLast10 ?? 0)) * 60 + maxDrawdown * 40;
    const consistencyBonus = Math.max(0, (paperWindowMedianPnl ?? 0) * 200) + Math.max(0, netPnlPerTrade * 120);
    const fitnessScore =
      qmon.metrics.totalPnl + (qmon.metrics.totalEstimatedNetEvUsd ?? 0) + robustnessBonus + consistencyBonus - frictionPenalty - instabilityPenalty;
    const championScore = isChampionEligible ? fitnessScore + paperLongWindowPnlSum * 20 : null;

    return {
      championScore,
      fitnessScore,
      paperWindowMedianPnl,
      paperWindowPnlSum,
      paperLongWindowPnlSum,
      negativeWindowRateLast10,
      worstWindowPnlLast10,
      recentAvgSlippageBps,
      netPnlPerTrade,
      feeRatio,
      slippageRatio,
      grossAlphaCapture,
      noTradeDisciplineScore,
      regimeBreakdown,
      triggerBreakdown,
      maxDrawdown,
      isChampionEligible,
      championEligibilityReasons,
    };
  }

  private finalizePaperWindowHistory(qmons: readonly Qmon[]): Qmon[] {
    const finalizedQmons: Qmon[] = [];

    for (const qmon of qmons) {
      let updatedQmon = qmon;

      if (qmon.paperWindowBaselinePnl !== null) {
        updatedQmon = this.appendPaperWindowPnl(qmon, qmon.metrics.totalPnl - qmon.paperWindowBaselinePnl);
      } else {
        updatedQmon = this.refreshMetrics({
          ...qmon,
          paperWindowBaselinePnl: qmon.metrics.totalPnl,
          currentWindowSlippageTotalBps: 0,
          currentWindowSlippageFillCount: 0,
        });
      }

      finalizedQmons.push(updatedQmon);
    }

    return finalizedQmons;
  }

  private shouldReplaceChampionCandidate(candidate: Qmon, currentBest: Qmon): boolean {
    const candidateChampionScore = candidate.metrics.championScore ?? Number.NEGATIVE_INFINITY;
    const currentBestChampionScore = currentBest.metrics.championScore ?? Number.NEGATIVE_INFINITY;
    let shouldReplace = false;

    if (candidateChampionScore > currentBestChampionScore) {
      shouldReplace = true;
    } else if (
      candidateChampionScore === currentBestChampionScore &&
      (candidate.metrics.fitnessScore ?? null) !== null &&
      (currentBest.metrics.fitnessScore ?? null) !== null
    ) {
      if ((candidate.metrics.fitnessScore ?? 0) > (currentBest.metrics.fitnessScore ?? 0)) {
        shouldReplace = true;
      } else if (
        (candidate.metrics.fitnessScore ?? 0) === (currentBest.metrics.fitnessScore ?? 0) &&
        candidate.metrics.totalPnl > currentBest.metrics.totalPnl
      ) {
        shouldReplace = true;
      }
    }

    return shouldReplace;
  }

  private selectActiveChampion(qmons: readonly Qmon[]): Qmon | null {
    let selectedChampion: Qmon | null = null;

    for (const qmon of qmons) {
      if (!qmon.metrics.isChampionEligible || qmon.lifecycle !== "active") {
        continue;
      }

      if (selectedChampion === null || this.shouldReplaceChampionCandidate(qmon, selectedChampion)) {
        selectedChampion = qmon;
      }
    }

    return selectedChampion;
  }

  private applyChampionRoles(qmons: readonly Qmon[], activeChampionQmonId: string | null): Qmon[] {
    const qmonsWithRoles: Qmon[] = [];

    for (const qmon of qmons) {
      const role: QmonRole = activeChampionQmonId !== null && qmon.id === activeChampionQmonId ? "champion" : "candidate";
      qmonsWithRoles.push({
        ...qmon,
        role,
      });
    }

    return qmonsWithRoles;
  }
}
