/**
 * @section imports:internals
 */

import type { MarketKey, TradingAction } from "../qmon/index.ts";

/**
 * @section types
 */

export type ExecutionMode = "paper" | "real";

export type BalanceSnapshotState = "fresh" | "stale" | "unavailable";

export type MarketExecutionState =
  | "paper"
  | "real-armed"
  | "real-pending-entry"
  | "real-open"
  | "real-pending-exit"
  | "real-error"
  | "real-halted"
  | "real-recovery-required";

export type ConfirmedLiveSeatSummary = {
  readonly action: TradingAction;
  readonly shareCount: number;
  readonly entryPrice: number | null;
  readonly enteredAt: number;
};

export type MarketExecutionRoute = {
  readonly market: MarketKey;
  readonly route: ExecutionMode;
  readonly executionState: MarketExecutionState;
  readonly isHalted: boolean;
  readonly hasPendingIntent: boolean;
  readonly pendingIntentKey: string | null;
  readonly hasLivePosition: boolean;
  readonly livePositionAction: TradingAction | null;
  readonly confirmedLiveSeat: ConfirmedLiveSeatSummary | null;
  readonly lastError: string | null;
};

export type RuntimeExecutionStatus = {
  readonly mode: ExecutionMode;
  readonly allowlistedMarkets: readonly MarketKey[];
  readonly balanceUsd: number | null;
  readonly balanceState: BalanceSnapshotState;
  readonly balanceUpdatedAt: number | null;
  readonly cpnlSessionStartedAt: number | null;
  readonly marketRoutes: readonly MarketExecutionRoute[];
};
