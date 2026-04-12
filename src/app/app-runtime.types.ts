/**
 * @section imports:internals
 */

import type { MarketKey, QmonRealSeat } from "../qmon/index.ts";

/**
 * @section types
 */

export type ExecutionMode = "paper" | "real";

export type RuntimeMarketRoute = {
  readonly market: MarketKey;
  readonly route: ExecutionMode;
  readonly hasChampion: boolean;
  readonly hasRealSeat: boolean;
  readonly realSeat: QmonRealSeat;
};

export type RuntimeExecutionStatus = {
  readonly mode: ExecutionMode;
  readonly marketRoutes: readonly RuntimeMarketRoute[];
};
