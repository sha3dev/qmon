/**
 * @section types
 */

export type MarketKey = `${string}-${string}`;

export type QmonTrend = "UP" | "DOWN" | "FLAT";

export type QmonTradeAction = "BUY_UP" | "BUY_DOWN";

export type QmonRole = "champion" | "candidate";

export type QmonStrategyId = "late-trend-reverse" | "mid-window-cheap-trend-x2";

export type QmonPosition = {
  readonly action: QmonTradeAction | null;
  readonly shareCount: number | null;
  readonly entryPrice: number | null;
  readonly entryCostUsd: number | null;
  readonly enteredAt: number | null;
  readonly marketStartMs: number | null;
  readonly marketEndMs: number | null;
  readonly priceToBeat: number | null;
};

export type QmonTriggerRecord = {
  readonly firedAt: number;
  readonly previousTrend: QmonTrend;
  readonly nextTrend: Exclude<QmonTrend, "FLAT">;
  readonly action: QmonTradeAction;
  readonly triggerProgress: number;
};

export type QmonStrategyState = {
  readonly observedWindowStartMs: number | null;
  readonly previousTrend: QmonTrend;
  readonly hasTriggeredThisWindow: boolean;
  readonly lastTrigger: QmonTriggerRecord | null;
  readonly lastSkipReason: string | null;
};

export type QmonMetrics = {
  readonly totalPnl: number;
  readonly totalTrades: number;
  readonly recentWindowPnls: readonly number[];
  readonly recentWindowPnlSum: number;
  readonly isActive: boolean;
  readonly lastSettledAt: number | null;
};

export type Qmon = {
  readonly id: string;
  readonly name: string;
  readonly market: MarketKey;
  readonly strategyId: QmonStrategyId;
  readonly strategyName: string;
  readonly strategyDescription: string;
  readonly role: QmonRole;
  readonly currentTrend: QmonTrend;
  readonly strategyState: QmonStrategyState;
  readonly paperPosition: QmonPosition;
  readonly currentWindowPnl: number;
  readonly metrics: QmonMetrics;
};

export type QmonRealSeat = {
  readonly route: "paper" | "real";
  readonly mirroredQmonId: string | null;
  readonly action: QmonTradeAction | null;
  readonly shareCount: number | null;
  readonly entryPrice: number | null;
  readonly hasOpenPosition: boolean;
  readonly lastSyncedAt: number | null;
};

export type QmonPopulation = {
  readonly market: MarketKey;
  readonly qmons: readonly Qmon[];
  readonly activeChampionQmonId: string | null;
  readonly currentTrend: QmonTrend;
  readonly currentWindowStartMs: number | null;
  readonly lastUpdated: number;
  readonly realSeat: QmonRealSeat;
};

export type QmonFamilyState = {
  readonly schemaVersion: 1;
  readonly populations: readonly QmonPopulation[];
  readonly createdAt: number;
  readonly lastUpdated: number;
};

export type QmonMutationState = {
  readonly hasStateMutation: boolean;
  readonly hasCriticalMutation: boolean;
};

export type QmonStrategyDefinition = {
  readonly strategyId: QmonStrategyId;
  readonly strategyName: string;
  readonly strategyDescription: string;
};
