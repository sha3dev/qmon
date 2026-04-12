/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { MarketKey, Qmon, QmonPosition, QmonStrategyDefinition, QmonStrategyState } from "./qmon.types.ts";

/**
 * @section consts
 */

const LATE_TREND_REVERSE_DEFINITION: QmonStrategyDefinition = {
  strategyId: "late-trend-reverse",
  strategyName: "Late Trend Reverse",
  strategyDescription: "Buys the new trend direction on the first UP/DOWN flip detected inside the final 10% of the market window.",
};

/**
 * @section class
 */

export class QmonPresetStrategyService {
  /**
   * @section factory
   */

  public static createDefault(): QmonPresetStrategyService {
    const strategyService = new QmonPresetStrategyService();

    return strategyService;
  }

  /**
   * @section private:methods
   */

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

  private buildInitialStrategyState(): QmonStrategyState {
    const strategyState: QmonStrategyState = {
      observedWindowStartMs: null,
      previousTrend: "FLAT",
      hasTriggeredThisWindow: false,
      lastTrigger: null,
      lastSkipReason: null,
    };

    return strategyState;
  }

  private buildQmonName(market: MarketKey): string {
    const qmonName = `${market}-late-trend-reverse`;

    return qmonName;
  }

  /**
   * @section public:methods
   */

  public getDefinition(): QmonStrategyDefinition {
    const strategyDefinition = LATE_TREND_REVERSE_DEFINITION;

    return strategyDefinition;
  }

  public createMarketQmon(market: MarketKey): Qmon {
    const now = Date.now();
    const qmon: Qmon = {
      id: `qmon-${market}-${LATE_TREND_REVERSE_DEFINITION.strategyId}`,
      name: this.buildQmonName(market),
      market,
      strategyId: LATE_TREND_REVERSE_DEFINITION.strategyId,
      strategyName: LATE_TREND_REVERSE_DEFINITION.strategyName,
      strategyDescription: LATE_TREND_REVERSE_DEFINITION.strategyDescription,
      role: "candidate",
      currentTrend: "FLAT",
      strategyState: this.buildInitialStrategyState(),
      paperPosition: this.buildEmptyPosition(),
      currentWindowPnl: 0,
      metrics: {
        totalPnl: 0,
        totalTrades: 0,
        recentWindowPnls: Array.from({ length: config.QMON_CHAMPION_WINDOW_COUNT }, () => 0),
        recentWindowPnlSum: 0,
        isActive: false,
        lastSettledAt: null,
      },
    };

    void now;

    return qmon;
  }
}
