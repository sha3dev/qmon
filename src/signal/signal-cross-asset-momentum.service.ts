/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Lookback window in snapshots for computing recent asset returns.
 * At 500ms intervals, 60 snapshots ≈ 30 seconds.
 */
const LOOKBACK_WINDOW = 60;

/**
 * Scaling factor for tanh normalization of the cross-asset signal.
 * Aligned with velocity scaling so cross-asset momentum is comparable.
 */
const CROSS_ASSET_SCALE = 500;

/**
 * The lead asset whose momentum propagates to other assets.
 * BTC dominates crypto price action and typically leads alt moves.
 */
const LEAD_ASSET = "btc";

/**
 * @section class
 */
export class SignalCrossAssetMomentum {
  /**
   * @section private:attributes
   */

  private readonly assets: readonly string[];

  /**
   * @section constructor
   */

  public constructor(assets: readonly string[]) {
    this.assets = assets;
  }

  /**
   * @section private:methods
   */

  /**
   * Compute the recent return for an asset over the lookback window.
   * Returns null if the snapshot buffer is too short or prices are missing.
   */
  private computeReturn(snapshots: readonly Snapshot[], asset: string): number | null {
    const key = `${asset}_chainlink_price`;
    const currentIdx = snapshots.length - 1;
    const lookbackIdx = currentIdx - LOOKBACK_WINDOW;

    let result: number | null = null;

    if (lookbackIdx >= 0) {
      const currentSnap = snapshots[currentIdx];
      const lookbackSnap = snapshots[lookbackIdx];
      const currentPrice = currentSnap ? (currentSnap[key] ?? null) : null;
      const lookbackPrice = lookbackSnap ? (lookbackSnap[key] ?? null) : null;

      if (typeof currentPrice === "number" && typeof lookbackPrice === "number" && lookbackPrice > 0) {
        result = (currentPrice - lookbackPrice) / lookbackPrice;
      }
    }

    return result;
  }

  /**
   * Compute the average return across all other assets excluding the target.
   * Weighted equally for simplicity; BTC naturally dominates by magnitude.
   */
  private computePeerMomentum(snapshots: readonly Snapshot[], excludeAsset: string): number | null {
    let sumReturn = 0;
    let count = 0;

    for (let i = 0; i < this.assets.length; i++) {
      const asset = this.assets[i];
      if (asset === undefined || asset === excludeAsset) {
        continue;
      }
      const ret = this.computeReturn(snapshots, asset);
      if (ret !== null) {
        sumReturn += ret;
        count++;
      }
    }

    const result = count > 0 ? sumReturn / count : null;
    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the cross-asset momentum signal.
   * For BTC: uses average return of all other assets as a confirmation signal.
   * For alts: uses BTC's return as a leading indicator.
   * Positive = peers moving up (bullish contagion), negative = bearish.
   * Normalized to [-1, 1] via tanh.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string): SignalValue {
    let result: SignalValue = null;

    if (asset === LEAD_ASSET) {
      /** BTC uses peer average as confirmation */
      const peerMomentum = this.computePeerMomentum(snapshots, asset);
      if (peerMomentum !== null) {
        result = Math.tanh(peerMomentum * CROSS_ASSET_SCALE);
      }
    } else {
      /** Alts use BTC as leading indicator */
      const leadReturn = this.computeReturn(snapshots, LEAD_ASSET);
      if (leadReturn !== null) {
        result = Math.tanh(leadReturn * CROSS_ASSET_SCALE);
      }
    }

    return result;
  }
}
