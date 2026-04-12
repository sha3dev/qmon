/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { RegimeResult } from "../regime/regime.types.ts";
import type { StructuredSignalResult } from "../signal/signal.types.ts";
import { QmonChampionService } from "./qmon-champion.service.ts";
import { QmonPresetStrategyService } from "./qmon-preset-strategy.service.ts";
import type {
  MarketKey,
  Qmon,
  QmonFamilyState,
  QmonMutationState,
  QmonPopulation,
  QmonPosition,
  QmonStrategyState,
  QmonTradeAction,
  QmonTrend,
} from "./qmon.types.ts";

/**
 * @section class
 */

export class QmonEngine {
  /**
   * @section private:attributes
   */

  private readonly assets: readonly string[];
  private readonly windows: readonly string[];
  private readonly presetStrategyService: QmonPresetStrategyService;
  private readonly championService: QmonChampionService;
  private familyState: QmonFamilyState;
  private stateSnapshotVersion: number;
  private mutationState: QmonMutationState;

  /**
   * @section constructor
   */

  public constructor(
    assets: readonly string[],
    windows: readonly string[],
    presetStrategyService: QmonPresetStrategyService,
    championService: QmonChampionService,
    initialFamilyState?: QmonFamilyState,
  ) {
    this.assets = assets;
    this.windows = windows;
    this.presetStrategyService = presetStrategyService;
    this.championService = championService;
    this.familyState = initialFamilyState ?? this.createInitialFamilyState();
    this.stateSnapshotVersion = 0;
    this.mutationState = {
      hasStateMutation: false,
      hasCriticalMutation: false,
    };
  }

  /**
   * @section static:properties
   */

  private static readonly MID_WINDOW_ENTRY_PROGRESS = 0.5;
  private static readonly MAX_CHEAP_TOKEN_PRICE = 0.2;
  private static readonly TAKE_PROFIT_MULTIPLIER = 2;

  /**
   * @section factory
   */

  public static createDefault(assets: readonly string[], windows: readonly string[], initialFamilyState?: QmonFamilyState): QmonEngine {
    const engine = new QmonEngine(assets, windows, QmonPresetStrategyService.createDefault(), QmonChampionService.createDefault(), initialFamilyState);

    return engine;
  }

  /**
   * @section private:methods
   */

  private createInitialFamilyState(): QmonFamilyState {
    const createdAt = Date.now();
    const populations: QmonPopulation[] = [];

    for (const asset of this.assets) {
      for (const windowLabel of this.windows) {
        const market = `${asset}-${windowLabel}` as MarketKey;
        populations.push({
          market,
          qmons: this.presetStrategyService
            .getDefinitions()
            .map((strategyDefinition) => this.presetStrategyService.createMarketQmon(market, strategyDefinition)),
          activeChampionQmonId: null,
          currentTrend: "FLAT",
          currentWindowStartMs: null,
          lastUpdated: createdAt,
          realSeat: {
            route: "paper",
            mirroredQmonId: null,
            action: null,
            shareCount: null,
            entryPrice: null,
            hasOpenPosition: false,
            lastSyncedAt: null,
          },
        });
      }
    }

    const familyState: QmonFamilyState = {
      schemaVersion: 1,
      populations,
      createdAt,
      lastUpdated: createdAt,
    };

    return familyState;
  }

  private markMutation(hasCriticalMutation: boolean): void {
    this.stateSnapshotVersion += 1;
    this.mutationState = {
      hasStateMutation: true,
      hasCriticalMutation: this.mutationState.hasCriticalMutation || hasCriticalMutation,
    };
  }

  private splitMarket(market: MarketKey): { asset: string; windowLabel: string } {
    const [asset = "", windowLabel = ""] = market.split("-");
    const marketParts = {
      asset,
      windowLabel,
    };

    return marketParts;
  }

  private deriveTrend(regimes: RegimeResult, asset: string): QmonTrend {
    let trend: QmonTrend = "FLAT";
    const direction = regimes[asset]?.direction ?? "flat";

    if (direction === "trending-up") {
      trend = "UP";
    } else {
      if (direction === "trending-down") {
        trend = "DOWN";
      }
    }

    return trend;
  }

  private buildEmptyPosition(): QmonPosition {
    const emptyPosition: QmonPosition = {
      action: null,
      shareCount: null,
      entryPrice: null,
      entryCostUsd: null,
      enteredAt: null,
      marketStartMs: null,
      marketEndMs: null,
      priceToBeat: null,
    };

    return emptyPosition;
  }

  private resetStrategyWindow(strategyState: QmonStrategyState, nextWindowStartMs: number | null, currentTrend: QmonTrend): QmonStrategyState {
    const nextStrategyState: QmonStrategyState = {
      observedWindowStartMs: nextWindowStartMs,
      previousTrend: currentTrend,
      hasTriggeredThisWindow: false,
      lastTrigger: strategyState.lastTrigger,
      lastSkipReason: null,
    };

    return nextStrategyState;
  }

  private appendRecentWindowPnl(qmon: Qmon, windowPnl: number, settledAt: number | null): Qmon {
    const recentWindowPnls = [...qmon.metrics.recentWindowPnls, windowPnl].slice(-config.QMON_CHAMPION_WINDOW_COUNT);
    const recentWindowPnlSum = recentWindowPnls.reduce((runningWindowPnl, currentWindowPnl) => runningWindowPnl + currentWindowPnl, 0);
    const nextQmon: Qmon = {
      ...qmon,
      currentWindowPnl: 0,
      metrics: {
        ...qmon.metrics,
        recentWindowPnls,
        recentWindowPnlSum,
        isActive: recentWindowPnlSum > 0,
        lastSettledAt: settledAt,
      },
    };

    return nextQmon;
  }

  private resolveWinningAction(priceToBeat: number | null, chainlinkPrice: number | null): QmonTradeAction | null {
    let winningAction: QmonTradeAction | null = null;

    if (priceToBeat !== null && chainlinkPrice !== null) {
      winningAction = chainlinkPrice > priceToBeat ? "BUY_UP" : "BUY_DOWN";
    }

    return winningAction;
  }

  private settlePaperPosition(qmon: Qmon, chainlinkPrice: number | null, settledAt: number): Qmon {
    const paperPosition = qmon.paperPosition;
    const winningAction = this.resolveWinningAction(paperPosition.priceToBeat, chainlinkPrice);
    let nextQmon = qmon;

    if (paperPosition.action !== null && paperPosition.shareCount !== null && paperPosition.entryCostUsd !== null && winningAction !== null) {
      const settlementValue = paperPosition.action === winningAction ? paperPosition.shareCount : 0;
      const realizedPnl = settlementValue - paperPosition.entryCostUsd;
      nextQmon = {
        ...qmon,
        paperPosition: this.buildEmptyPosition(),
        currentWindowPnl: qmon.currentWindowPnl + realizedPnl,
        metrics: {
          ...qmon.metrics,
          totalPnl: qmon.metrics.totalPnl + realizedPnl,
          totalTrades: qmon.metrics.totalTrades + 1,
          lastSettledAt: settledAt,
        },
      };
    }

    return nextQmon;
  }

  private maybeRollWindow(qmon: Qmon, currentWindowStartMs: number | null, currentTrend: QmonTrend, chainlinkPrice: number | null, evaluatedAt: number): Qmon {
    const previousWindowStartMs = qmon.strategyState.observedWindowStartMs;
    const hasWindowRolled = previousWindowStartMs !== null && currentWindowStartMs !== null && previousWindowStartMs !== currentWindowStartMs;
    let nextQmon = qmon;

    if (hasWindowRolled) {
      nextQmon = this.settlePaperPosition(nextQmon, chainlinkPrice, evaluatedAt);
      nextQmon = this.appendRecentWindowPnl(nextQmon, nextQmon.currentWindowPnl, evaluatedAt);
      nextQmon = {
        ...nextQmon,
        strategyState: this.resetStrategyWindow(nextQmon.strategyState, currentWindowStartMs, currentTrend),
      };
    } else {
      if (previousWindowStartMs === null) {
        nextQmon = {
          ...nextQmon,
          strategyState: this.resetStrategyWindow(nextQmon.strategyState, currentWindowStartMs, currentTrend),
        };
      }
    }

    return nextQmon;
  }

  private maybeSettleExpiredPosition(qmon: Qmon, chainlinkPrice: number | null, evaluatedAt: number): Qmon {
    const marketEndMs = qmon.paperPosition.marketEndMs;
    const hasExpiredPosition = marketEndMs !== null && qmon.paperPosition.action !== null && evaluatedAt >= marketEndMs;
    let nextQmon = qmon;

    if (hasExpiredPosition) {
      nextQmon = this.settlePaperPosition(qmon, chainlinkPrice, evaluatedAt);
    }

    return nextQmon;
  }

  private calculateLateZoneProgress(currentWindowStartMs: number | null, marketEndMs: number | null, evaluatedAt: number): number | null {
    let windowProgress: number | null = null;

    if (currentWindowStartMs !== null && marketEndMs !== null && marketEndMs > currentWindowStartMs) {
      windowProgress = (evaluatedAt - currentWindowStartMs) / (marketEndMs - currentWindowStartMs);
    }

    return windowProgress;
  }

  private resolveEntryAction(nextTrend: QmonTrend): QmonTradeAction | null {
    let entryAction: QmonTradeAction | null = null;

    if (nextTrend === "UP") {
      entryAction = "BUY_UP";
    } else {
      if (nextTrend === "DOWN") {
        entryAction = "BUY_DOWN";
      }
    }

    return entryAction;
  }

  private resolveEntryPrice(entryAction: QmonTradeAction | null, upPrice: number | null, downPrice: number | null): number | null {
    let entryPrice: number | null = null;

    if (entryAction === "BUY_UP") {
      entryPrice = upPrice;
    } else {
      if (entryAction === "BUY_DOWN") {
        entryPrice = downPrice;
      }
    }

    return entryPrice;
  }

  private resolveRequestedShares(entryPrice: number | null): number | null {
    let requestedShares: number | null = null;

    if (entryPrice !== null && entryPrice > 0) {
      requestedShares = Math.max(config.QMON_MIN_ENTRY_SHARES, Math.ceil(config.QMON_MIN_ENTRY_USD / entryPrice));
    }

    return requestedShares;
  }

  private openPaperPosition(
    qmon: Qmon,
    currentTrend: QmonTrend,
    triggerProgress: number,
    entryPrice: number,
    requestedShares: number,
    currentWindowStartMs: number | null,
    marketEndMs: number | null,
    priceToBeat: number | null,
    evaluatedAt: number,
  ): Qmon {
    const entryAction = this.resolveEntryAction(currentTrend);
    const previousTrend = qmon.strategyState.previousTrend;
    const nextQmon: Qmon = {
      ...qmon,
      currentTrend,
      paperPosition: {
        action: entryAction,
        shareCount: requestedShares,
        entryPrice,
        entryCostUsd: requestedShares * entryPrice,
        enteredAt: evaluatedAt,
        marketStartMs: currentWindowStartMs,
        marketEndMs,
        priceToBeat,
      },
      strategyState: {
        ...qmon.strategyState,
        previousTrend: currentTrend,
        hasTriggeredThisWindow: true,
        lastSkipReason: null,
        lastTrigger:
          previousTrend !== "FLAT" && currentTrend !== "FLAT" && entryAction !== null
            ? {
                firedAt: evaluatedAt,
                previousTrend,
                nextTrend: currentTrend,
                action: entryAction,
                triggerProgress,
              }
            : qmon.strategyState.lastTrigger,
      },
    };

    return nextQmon;
  }

  private hasReachedTakeProfit(qmon: Qmon, upPrice: number | null, downPrice: number | null): boolean {
    const entryPrice = qmon.paperPosition.entryPrice;
    const action = qmon.paperPosition.action;
    let hasReachedTakeProfit = false;

    if (entryPrice !== null && action !== null) {
      const currentTokenPrice = this.resolveEntryPrice(action, upPrice, downPrice);

      if (currentTokenPrice !== null) {
        hasReachedTakeProfit = currentTokenPrice >= entryPrice * QmonEngine.TAKE_PROFIT_MULTIPLIER;
      }
    }

    return hasReachedTakeProfit;
  }

  private settleOpenPositionAtMarketPrice(qmon: Qmon, upPrice: number | null, downPrice: number | null, settledAt: number): Qmon {
    const action = qmon.paperPosition.action;
    const shareCount = qmon.paperPosition.shareCount;
    const entryCostUsd = qmon.paperPosition.entryCostUsd;
    const exitPrice = this.resolveEntryPrice(action, upPrice, downPrice);
    let nextQmon = qmon;

    if (action !== null && shareCount !== null && entryCostUsd !== null && exitPrice !== null) {
      const realizedPnl = shareCount * exitPrice - entryCostUsd;
      nextQmon = {
        ...qmon,
        paperPosition: this.buildEmptyPosition(),
        currentWindowPnl: qmon.currentWindowPnl + realizedPnl,
        metrics: {
          ...qmon.metrics,
          totalPnl: qmon.metrics.totalPnl + realizedPnl,
          totalTrades: qmon.metrics.totalTrades + 1,
          lastSettledAt: settledAt,
        },
      };
    }

    return nextQmon;
  }

  private maybeTakeProfit(qmon: Qmon, upPrice: number | null, downPrice: number | null, evaluatedAt: number): Qmon {
    const shouldTakeProfit = qmon.strategyId === "mid-window-cheap-trend-x2" && this.hasReachedTakeProfit(qmon, upPrice, downPrice);
    let nextQmon = qmon;

    if (shouldTakeProfit) {
      nextQmon = this.settleOpenPositionAtMarketPrice(qmon, upPrice, downPrice, evaluatedAt);
    }

    return nextQmon;
  }

  private skipPaperEntry(qmon: Qmon, currentTrend: QmonTrend, skipReason: string): Qmon {
    const skippedQmon: Qmon = {
      ...qmon,
      currentTrend,
      strategyState: {
        ...qmon.strategyState,
        previousTrend: currentTrend,
        lastSkipReason: skipReason,
      },
    };

    return skippedQmon;
  }

  private evaluateLateTrendReverse(
    qmon: Qmon,
    currentTrend: QmonTrend,
    currentWindowStartMs: number | null,
    marketEndMs: number | null,
    priceToBeat: number | null,
    upPrice: number | null,
    downPrice: number | null,
    evaluatedAt: number,
  ): Qmon {
    const lateZoneProgress = this.calculateLateZoneProgress(currentWindowStartMs, marketEndMs, evaluatedAt);
    const isLateZone = lateZoneProgress !== null && lateZoneProgress >= 1 - config.QMON_LATE_ZONE_FRACTION && lateZoneProgress <= 1;
    const hasDirectionalFlip =
      isLateZone && qmon.strategyState.previousTrend !== "FLAT" && currentTrend !== "FLAT" && qmon.strategyState.previousTrend !== currentTrend;
    const canOpenPosition = qmon.paperPosition.action === null && !qmon.strategyState.hasTriggeredThisWindow;
    const shouldAttemptEntry = hasDirectionalFlip && canOpenPosition;
    let nextQmon: Qmon = {
      ...qmon,
      currentTrend,
      strategyState: {
        ...qmon.strategyState,
        previousTrend: currentTrend,
      },
    };

    if (shouldAttemptEntry && lateZoneProgress !== null) {
      const entryAction = this.resolveEntryAction(currentTrend);
      const entryPrice = this.resolveEntryPrice(entryAction, upPrice, downPrice);
      const requestedShares = this.resolveRequestedShares(entryPrice);

      if (entryAction === null || entryPrice === null || requestedShares === null) {
        nextQmon = this.skipPaperEntry(nextQmon, currentTrend, "missing-price");
      } else {
        if (requestedShares < config.QMON_MIN_ENTRY_SHARES || requestedShares * entryPrice < config.QMON_MIN_ENTRY_USD) {
          nextQmon = this.skipPaperEntry(nextQmon, currentTrend, "minimum-size-not-met");
        } else {
          nextQmon = this.openPaperPosition(
            nextQmon,
            currentTrend,
            lateZoneProgress,
            entryPrice,
            requestedShares,
            currentWindowStartMs,
            marketEndMs,
            priceToBeat,
            evaluatedAt,
          );
        }
      }
    }

    return nextQmon;
  }

  private evaluateMidWindowCheapTrendX2(
    qmon: Qmon,
    currentTrend: QmonTrend,
    currentWindowStartMs: number | null,
    marketEndMs: number | null,
    priceToBeat: number | null,
    upPrice: number | null,
    downPrice: number | null,
    evaluatedAt: number,
  ): Qmon {
    const windowProgress = this.calculateLateZoneProgress(currentWindowStartMs, marketEndMs, evaluatedAt);
    const isEligibleWindowHalf = windowProgress !== null && windowProgress >= QmonEngine.MID_WINDOW_ENTRY_PROGRESS;
    const entryAction = this.resolveEntryAction(currentTrend);
    const entryPrice = this.resolveEntryPrice(entryAction, upPrice, downPrice);
    const requestedShares = this.resolveRequestedShares(entryPrice);
    const isCheapEnough = entryPrice !== null && entryPrice <= QmonEngine.MAX_CHEAP_TOKEN_PRICE;
    const canOpenPosition = qmon.paperPosition.action === null && !qmon.strategyState.hasTriggeredThisWindow;
    const shouldAttemptEntry = isEligibleWindowHalf && currentTrend !== "FLAT" && isCheapEnough && canOpenPosition;
    let nextQmon: Qmon = {
      ...qmon,
      currentTrend,
      strategyState: {
        ...qmon.strategyState,
        previousTrend: currentTrend,
      },
    };

    if (shouldAttemptEntry && windowProgress !== null && entryPrice !== null && requestedShares !== null) {
      if (requestedShares < config.QMON_MIN_ENTRY_SHARES || requestedShares * entryPrice < config.QMON_MIN_ENTRY_USD) {
        nextQmon = this.skipPaperEntry(nextQmon, currentTrend, "minimum-size-not-met");
      } else {
        nextQmon = this.openPaperPosition(
          nextQmon,
          currentTrend,
          windowProgress,
          entryPrice,
          requestedShares,
          currentWindowStartMs,
          marketEndMs,
          priceToBeat,
          evaluatedAt,
        );
      }
    } else {
      if (isEligibleWindowHalf && currentTrend !== "FLAT" && canOpenPosition && !isCheapEnough) {
        nextQmon = this.skipPaperEntry(nextQmon, currentTrend, "token-price-above-cap");
      }
    }

    return nextQmon;
  }

  private evaluatePopulation(
    population: QmonPopulation,
    structuredSignals: StructuredSignalResult,
    regimes: RegimeResult,
    evaluatedAt: number,
  ): QmonPopulation {
    const { asset, windowLabel } = this.splitMarket(population.market);
    const assetSignals = structuredSignals[asset] ?? null;
    const windowSignals = assetSignals?.windows[windowLabel] ?? null;
    const chainlinkPrice = assetSignals?.chainlinkPrice ?? null;
    const currentTrend = this.deriveTrend(regimes, asset);
    const currentWindowStartMs = windowSignals?.prices.marketStartMs ?? null;
    const marketEndMs = windowSignals?.prices.marketEndMs ?? null;
    const priceToBeat = windowSignals?.prices.priceToBeat ?? null;
    const upPrice = windowSignals?.prices.upPrice ?? null;
    const downPrice = windowSignals?.prices.downPrice ?? null;
    const evaluatedQmons = population.qmons.map((existingQmon) => {
      let evaluatedQmon = existingQmon;

      evaluatedQmon = this.maybeRollWindow(evaluatedQmon, currentWindowStartMs, currentTrend, chainlinkPrice, evaluatedAt);
      evaluatedQmon = this.maybeTakeProfit(evaluatedQmon, upPrice, downPrice, evaluatedAt);
      evaluatedQmon = this.maybeSettleExpiredPosition(evaluatedQmon, chainlinkPrice, evaluatedAt);
      if (evaluatedQmon.strategyId === "late-trend-reverse") {
        evaluatedQmon = this.evaluateLateTrendReverse(
          evaluatedQmon,
          currentTrend,
          currentWindowStartMs,
          marketEndMs,
          priceToBeat,
          upPrice,
          downPrice,
          evaluatedAt,
        );
      } else {
        if (evaluatedQmon.strategyId === "mid-window-cheap-trend-x2") {
          evaluatedQmon = this.evaluateMidWindowCheapTrendX2(
            evaluatedQmon,
            currentTrend,
            currentWindowStartMs,
            marketEndMs,
            priceToBeat,
            upPrice,
            downPrice,
            evaluatedAt,
          );
        }
      }

      return evaluatedQmon;
    });
    const refreshedPopulation = this.championService.refreshPopulation({
      ...population,
      qmons: evaluatedQmons,
      currentTrend,
      currentWindowStartMs,
      lastUpdated: evaluatedAt,
    });

    return refreshedPopulation;
  }

  /**
   * @section public:methods
   */

  public getFamilyState(): QmonFamilyState {
    const familyState = this.familyState;

    return familyState;
  }

  public replaceFamilyState(familyState: QmonFamilyState): void {
    this.familyState = familyState;
    this.markMutation(true);
  }

  public getStateSnapshotVersion(): number {
    const stateSnapshotVersion = this.stateSnapshotVersion;

    return stateSnapshotVersion;
  }

  public consumeMutationState(): QmonMutationState {
    const mutationState = this.mutationState;

    this.mutationState = {
      hasStateMutation: false,
      hasCriticalMutation: false,
    };

    return mutationState;
  }

  public evaluateAll(structuredSignals: StructuredSignalResult, regimes: RegimeResult, evaluatedAt: number): void {
    const evaluatedPopulations = this.familyState.populations.map((population) => this.evaluatePopulation(population, structuredSignals, regimes, evaluatedAt));

    this.familyState = {
      ...this.familyState,
      populations: evaluatedPopulations,
      lastUpdated: evaluatedAt,
    };
    this.markMutation(false);
  }
}
