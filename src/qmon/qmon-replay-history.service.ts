/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { StructuredSignalResult } from "../signal/signal.types.ts";
import type { MarketKey } from "./qmon.types.ts";

/**
 * @section types
 */

type ActiveReplayWindow = {
  market: MarketKey;
  marketStartMs: number;
  marketEndMs: number | null;
  snapshots: Snapshot[];
};

type CompletedReplayWindow = {
  market: MarketKey;
  marketStartMs: number;
  marketEndMs: number | null;
  snapshots: Snapshot[];
};

/**
 * @section class
 */

export class QmonReplayHistoryService {
  /**
   * @section private:attributes
   */

  private readonly retainedWindowCount: number;
  private readonly activeWindowsByMarket: Map<MarketKey, ActiveReplayWindow>;
  private readonly completedWindowsByMarket: Map<MarketKey, readonly CompletedReplayWindow[]>;
  private readonly hydrationTapeCacheByMarket: Map<MarketKey, readonly Snapshot[]>;

  /**
   * @section constructor
   */

  public constructor(retainedWindowCount = config.QMON_HYDRATION_WINDOW_COUNT) {
    this.retainedWindowCount = retainedWindowCount;
    this.activeWindowsByMarket = new Map();
    this.completedWindowsByMarket = new Map();
    this.hydrationTapeCacheByMarket = new Map();
  }

  /**
   * @section public:methods
   */

  /**
   * Record one live snapshot into every market replay tape derived from the structured payload.
   */
  public recordSnapshot(snapshot: Snapshot, structuredSignals: StructuredSignalResult): void {
    for (const [asset, assetResult] of Object.entries(structuredSignals)) {
      for (const [window, windowResult] of Object.entries(assetResult.windows)) {
        const marketStartMs = windowResult.prices.marketStartMs;

        if (typeof marketStartMs === "number") {
          this.recordMarketSnapshot(`${asset}-${window}`, snapshot, marketStartMs, windowResult.prices.marketEndMs);
        }
      }
    }
  }

  /**
   * Build the replay tape used to hydrate a newborn.
   * Includes the last completed windows plus the first snapshot of the active live window
   * so the most recent completed replay window can finalize cleanly.
   */
  public buildHydrationSnapshotTape(market: MarketKey): readonly Snapshot[] {
    let snapshotTape = this.hydrationTapeCacheByMarket.get(market) ?? null;

    if (snapshotTape === null) {
      const completedWindows = this.completedWindowsByMarket.get(market) ?? [];
      const activeWindow = this.activeWindowsByMarket.get(market) ?? null;
      const snapshots: Snapshot[] = [];

      for (const completedWindow of completedWindows) {
        snapshots.push(...completedWindow.snapshots);
      }

      if (activeWindow !== null && activeWindow.snapshots.length > 0) {
        const firstActiveSnapshot = activeWindow.snapshots[0] ?? null;

        if (firstActiveSnapshot !== null) {
          snapshots.push(firstActiveSnapshot);
        }
      }

      snapshotTape = snapshots;
      this.hydrationTapeCacheByMarket.set(market, snapshotTape);
    }

    return snapshotTape;
  }

  /**
   * @section private:methods
   */

  /**
   * Append one snapshot to the active tape of one market, finalizing the previous tape if the window changed.
   */
  private recordMarketSnapshot(market: MarketKey, snapshot: Snapshot, marketStartMs: number, marketEndMs: number | null): void {
    const activeWindow = this.activeWindowsByMarket.get(market) ?? null;

    if (activeWindow === null) {
      this.activeWindowsByMarket.set(market, {
        market,
        marketStartMs,
        marketEndMs,
        snapshots: [snapshot],
      });
      this.invalidateHydrationTapeCache(market);
    } else if (activeWindow.marketStartMs !== marketStartMs) {
      this.storeCompletedWindow({
        market,
        marketStartMs: activeWindow.marketStartMs,
        marketEndMs: activeWindow.marketEndMs,
        snapshots: activeWindow.snapshots,
      });
      this.activeWindowsByMarket.set(market, {
        market,
        marketStartMs,
        marketEndMs,
        snapshots: [snapshot],
      });
      this.invalidateHydrationTapeCache(market);
    } else {
      activeWindow.marketEndMs = marketEndMs;
      activeWindow.snapshots.push(snapshot);
    }
  }

  /**
   * Retain only the newest completed replay windows for one market.
   */
  private storeCompletedWindow(completedWindow: CompletedReplayWindow): void {
    const retainedCompletedWindows = this.completedWindowsByMarket.get(completedWindow.market) ?? [];
    const nextCompletedWindows = [...retainedCompletedWindows, completedWindow].slice(-this.retainedWindowCount);

    this.completedWindowsByMarket.set(completedWindow.market, nextCompletedWindows);
  }

  private invalidateHydrationTapeCache(market: MarketKey): void {
    this.hydrationTapeCacheByMarket.delete(market);
  }
}
