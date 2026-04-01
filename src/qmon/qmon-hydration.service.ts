/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { QmonReplayHistoryService } from "./qmon-replay-history.service.ts";
import type { MarketKey, Qmon } from "./qmon.types.ts";

/**
 * @section types
 */

type HydrationReplayRunner = (newbornQmon: Qmon, snapshotTape: readonly Snapshot[], currentWindowStartMs: number | null) => Qmon;

/**
 * @section class
 */

export class QmonHydrationService {
  /**
   * @section private:attributes
   */

  private readonly replayHistoryService: QmonReplayHistoryService;
  private readonly hydrationReplayRunner: HydrationReplayRunner;

  /**
   * @section constructor
   */

  public constructor(replayHistoryService: QmonReplayHistoryService, hydrationReplayRunner: HydrationReplayRunner) {
    this.replayHistoryService = replayHistoryService;
    this.hydrationReplayRunner = hydrationReplayRunner;
  }

  /**
   * @section public:methods
   */

  /**
   * Hydrate one newborn from the retained replay history of its market.
   */
  public hydrateNewbornQmon(newbornQmon: Qmon, currentWindowStartMs: number | null): Qmon {
    const snapshotTape = this.replayHistoryService.buildHydrationSnapshotTape(newbornQmon.market);
    let hydratedQmon = newbornQmon;

    if (snapshotTape.length > 0) {
      hydratedQmon = this.hydrationReplayRunner(newbornQmon, snapshotTape, currentWindowStartMs);
    }

    return hydratedQmon;
  }

  /**
   * Get the retained snapshot count for one market hydration tape.
   */
  public getHydrationSnapshotCount(market: MarketKey): number {
    const snapshotTape = this.replayHistoryService.buildHydrationSnapshotTape(market);

    return snapshotTape.length;
  }
}
