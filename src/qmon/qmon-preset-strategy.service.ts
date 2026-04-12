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

const MID_WINDOW_CHEAP_TREND_X2_DEFINITION: QmonStrategyDefinition = {
  strategyId: "mid-window-cheap-trend-x2",
  strategyName: "Mid Window Cheap Trend X2",
  strategyDescription: "After 50% of the window, buys the trend-aligned token when it costs at most 0.20 and exits when the token price doubles.",
};

const LATE_TREND_BAND_ENTRY_DEFINITION: QmonStrategyDefinition = {
  strategyId: "late-trend-band-entry",
  strategyName: "Late Trend Band Entry",
  strategyDescription:
    "Inside the final 25% of the window, buys the trend-aligned token when its price sits between 0.60 and 0.80, then holds until market resolution.",
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

  private buildStrategyName(market: MarketKey, strategyDefinition: QmonStrategyDefinition): string {
    const qmonName = `${market}-${strategyDefinition.strategyId}`;

    return qmonName;
  }

  /**
   * @section public:methods
   */

  public getDefinition(): QmonStrategyDefinition {
    const strategyDefinition = LATE_TREND_REVERSE_DEFINITION;

    return strategyDefinition;
  }

  public getDefinitions(): readonly QmonStrategyDefinition[] {
    const strategyDefinitions = [LATE_TREND_REVERSE_DEFINITION, MID_WINDOW_CHEAP_TREND_X2_DEFINITION, LATE_TREND_BAND_ENTRY_DEFINITION] as const;

    return strategyDefinitions;
  }

  public createMarketQmon(market: MarketKey, strategyDefinition: QmonStrategyDefinition): Qmon {
    const qmon: Qmon = {
      id: `qmon-${market}-${strategyDefinition.strategyId}`,
      name: this.buildStrategyName(market, strategyDefinition),
      market,
      strategyId: strategyDefinition.strategyId,
      strategyName: strategyDefinition.strategyName,
      strategyDescription: strategyDefinition.strategyDescription,
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

    return qmon;
  }
}
