/**
 * @section imports:internals
 */

import type { Qmon, QmonPopulation, QmonPosition, QmonRole, RegimePerformanceSlice, TriggerPerformanceSlice } from "./qmon.types.ts";

/**
 * @section consts
 */

const PAPER_CHAMPION_HISTORY_WINDOW = 5;
const PAPER_CHAMPION_LONG_HISTORY_WINDOW = 30;
const CHAMPION_MIN_FITNESS_SCORE = 150;
const CHAMPION_MIN_WIN_RATE = 0.55;
const CHAMPION_MAX_NEGATIVE_WINDOW_RATE = 0.4;
const CHAMPION_MAX_FEE_RATIO = 0.65;
const CHAMPION_MAX_DRAWDOWN = 5;
const CHAMPION_MIN_WINDOW_MEDIAN_PNL = 0.5;
const CHAMPION_MIN_REGIME_COVERAGE = 2;
const CHAMPION_RECENT_MEDIAN_WEIGHT = 260;
const CHAMPION_RECENT_SUM_WEIGHT = 120;
const CHAMPION_LONG_SUM_WEIGHT = 24;
const CHAMPION_NET_PNL_PER_TRADE_WEIGHT = 180;
const CHAMPION_REGIME_COVERAGE_WEIGHT = 40;
const CHAMPION_DISCIPLINE_WEIGHT = 20;
const CHAMPION_FEE_RATIO_PENALTY = 320;
const CHAMPION_SLIPPAGE_RATIO_PENALTY = 180;
const CHAMPION_AVG_SLIPPAGE_PENALTY = 8;
const CHAMPION_NEGATIVE_WINDOW_RATE_PENALTY = 220;
const CHAMPION_WORST_WINDOW_PENALTY = 80;
const CHAMPION_DRAWDOWN_PENALTY = 55;

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
    const grossAlphaCapture = qmon.metrics.grossAlphaCapture ?? 0;

    return grossAlphaCapture;
  }

  private calculateMaxDrawdown(qmon: Qmon): number {
    const maxDrawdown = qmon.metrics.maxDrawdown;

    return maxDrawdown;
  }

  private buildRegimeBreakdown(qmon: Qmon): readonly RegimePerformanceSlice[] {
    const regimeBreakdown = qmon.metrics.regimeBreakdown ?? [];

    return regimeBreakdown;
  }

  private buildTriggerBreakdown(qmon: Qmon): readonly TriggerPerformanceSlice[] {
    const triggerBreakdown = qmon.metrics.triggerBreakdown ?? [];

    return triggerBreakdown;
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
        recentAvgSlippageBps,
      },
    });
    const regimeBreakdown = this.buildRegimeBreakdown(qmon);
    const triggerBreakdown = this.buildTriggerBreakdown(qmon);
    const maxDrawdown = this.calculateMaxDrawdown(qmon);
    const noTradeDisciplineScore = this.calculateNoTradeDisciplineScore(qmon);
    const positiveRegimeCount = regimeBreakdown.filter((regimeSlice) => regimeSlice.tradeCount > 0 && regimeSlice.totalPnl >= 0).length;
    const robustnessBonus = positiveRegimeCount * CHAMPION_REGIME_COVERAGE_WEIGHT + noTradeDisciplineScore * CHAMPION_DISCIPLINE_WEIGHT;
    const frictionPenalty =
      feeRatio * CHAMPION_FEE_RATIO_PENALTY + slippageRatio * CHAMPION_SLIPPAGE_RATIO_PENALTY + recentAvgSlippageBps / CHAMPION_AVG_SLIPPAGE_PENALTY;
    const instabilityPenalty =
      negativeWindowRateLast10 * CHAMPION_NEGATIVE_WINDOW_RATE_PENALTY +
      Math.max(0, -(worstWindowPnlLast10 ?? 0)) * CHAMPION_WORST_WINDOW_PENALTY +
      maxDrawdown * CHAMPION_DRAWDOWN_PENALTY;
    const consistencyBonus =
      Math.max(0, (paperWindowMedianPnl ?? 0) * CHAMPION_RECENT_MEDIAN_WEIGHT) +
      Math.max(0, paperWindowPnlSum * CHAMPION_RECENT_SUM_WEIGHT) +
      Math.max(0, netPnlPerTrade * CHAMPION_NET_PNL_PER_TRADE_WEIGHT);
    const fitnessScore =
      qmon.metrics.totalPnl + (qmon.metrics.totalEstimatedNetEvUsd ?? 0) + robustnessBonus + consistencyBonus - frictionPenalty - instabilityPenalty;
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
    if ((paperWindowMedianPnl ?? 0) < CHAMPION_MIN_WINDOW_MEDIAN_PNL) {
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
    if (fitnessScore <= CHAMPION_MIN_FITNESS_SCORE) {
      championEligibilityReasons.push("low-fitness");
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
    const championScore =
      isChampionEligible
        ? fitnessScore +
          Math.max(0, paperLongWindowPnlSum * CHAMPION_LONG_SUM_WEIGHT) +
          Math.max(0, (paperWindowMedianPnl ?? 0) * CHAMPION_RECENT_MEDIAN_WEIGHT)
        : null;

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
