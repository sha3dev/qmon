/**
 * @section imports:internals
 */

import type {
  MarketKey,
  QmonConfirmedVenueSeat,
  QmonExecutionState,
  QmonPendingOrder,
  QmonPendingVenueOrderSnapshot,
} from "../qmon/index.ts";

/**
 * @section types
 */

export type ExecutionMode = "paper" | "real";

export type BalanceSnapshotState = "fresh" | "stale" | "unavailable";

export type MarketExecutionState = QmonExecutionState;

export type ConfirmedLiveSeatSummary = QmonConfirmedVenueSeat;

export type MarketExecutionRoute = {
  readonly market: MarketKey;
  readonly route: ExecutionMode;
  readonly executionState: MarketExecutionState;
  readonly isHalted: boolean;
  readonly hasPendingIntent: boolean;
  readonly pendingIntentKey: string | null;
  readonly pendingIntent: QmonPendingOrder | null;
  readonly orderId: string | null;
  readonly submittedAt: number | null;
  readonly pendingVenueOrders: readonly QmonPendingVenueOrderSnapshot[];
  readonly recoveryStartedAt: number | null;
  readonly lastReconciledAt: number | null;
  readonly hasLivePosition: boolean;
  readonly livePositionAction: ConfirmedLiveSeatSummary["action"] | null;
  readonly confirmedLiveSeat: ConfirmedLiveSeatSummary | null;
  readonly lastError: string | null;
};

export type RuntimeExecutionStatus = {
  readonly mode: ExecutionMode;
  readonly balanceUsd: number | null;
  readonly balanceState: BalanceSnapshotState;
  readonly balanceUpdatedAt: number | null;
  readonly cpnlSessionStartedAt: number | null;
  readonly marketRoutes: readonly MarketExecutionRoute[];
};

export type QmonDashboardPayload = {
  readonly generatedAt: number;
  readonly familyState: unknown;
  readonly runtimeExecutionStatus: RuntimeExecutionStatus;
  readonly diagnosticsOverview: unknown;
};
