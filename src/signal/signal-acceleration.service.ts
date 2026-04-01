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
 * Scaling factor for tanh normalization of acceleration.
 * Tuned so that a meaningful second-derivative at crypto price scales
 * produces moderate signal output.
 */
const ACCELERATION_SCALE = 50000;

/**
 * Number of snapshots for the short velocity window.
 * At 500ms intervals, 20 snapshots ≈ 10 seconds.
 */
const SHORT_WINDOW = 20;

/**
 * Number of snapshots for the long velocity window.
 * At 500ms intervals, 60 snapshots ≈ 30 seconds.
 */
const LONG_WINDOW = 60;

/**
 * @section class
 */
export class SignalAcceleration {
  /**
   * @section private:methods
   */

  /**
   * Compute the average per-snapshot return over a trailing window
   * ending at the given index. Returns null if insufficient data.
   */
  private averageReturn(snapshots: readonly Snapshot[], asset: string, endIdx: number, windowSize: number): number | null {
    const key = `${asset}_chainlink_price`;
    const startIdx = endIdx - windowSize;

    let result: number | null = null;

    if (startIdx >= 0) {
      const startSnap = snapshots[startIdx];
      const endSnap = snapshots[endIdx];
      const startPrice = startSnap ? (startSnap[key] ?? null) : null;
      const endPrice = endSnap ? (endSnap[key] ?? null) : null;

      if (typeof startPrice === "number" && typeof endPrice === "number" && startPrice > 0) {
        result = (endPrice - startPrice) / startPrice;
      }
    }

    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate acceleration as the difference between recent velocity
   * and earlier velocity (second derivative of price).
   * Positive = trend strengthening, negative = trend weakening.
   * Normalized to [-1, 1] via tanh.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string): SignalValue {
    const lastIdx = snapshots.length - 1;
    const recentVelocity = this.averageReturn(snapshots, asset, lastIdx, SHORT_WINDOW);
    const earlierVelocity = this.averageReturn(snapshots, asset, lastIdx - SHORT_WINDOW, LONG_WINDOW);

    let result: SignalValue = null;

    if (recentVelocity !== null && earlierVelocity !== null) {
      result = Math.tanh((recentVelocity - earlierVelocity) * ACCELERATION_SCALE);
    }

    return result;
  }
}
