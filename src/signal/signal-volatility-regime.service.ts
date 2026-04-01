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
 * Short volatility window in number of snapshots.
 * At 500ms intervals, 40 snapshots ≈ 20 seconds.
 */
const SHORT_VOL_WINDOW = 40;

/**
 * Long volatility window in number of snapshots.
 * At 500ms intervals, 240 snapshots ≈ 2 minutes.
 */
const LONG_VOL_WINDOW = 240;

/**
 * Minimum number of return observations to estimate volatility.
 */
const MIN_SAMPLES = 10;

/**
 * Scaling factor for tanh normalization of the regime ratio.
 * A ratio of 2.0 (vol expansion) maps to tanh(2 * 1.0) ≈ 0.76.
 */
const REGIME_SCALE = 2;

/**
 * @section class
 */
export class SignalVolatilityRegime {
  /**
   * @section private:methods
   */

  /**
   * Compute realized volatility (stdev of log-returns) over a window
   * ending at endIdx. Returns null if fewer than MIN_SAMPLES returns exist.
   */
  private computeWindowVolatility(snapshots: readonly Snapshot[], asset: string, endIdx: number, windowSize: number): number | null {
    const key = `${asset}_chainlink_price`;
    const startIdx = Math.max(0, endIdx - windowSize);
    let sumReturn = 0;
    let sumReturnSq = 0;
    let count = 0;

    for (let i = startIdx + 1; i <= endIdx; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      const prevPrice = prev ? (prev[key] ?? null) : null;
      const currPrice = curr ? (curr[key] ?? null) : null;

      if (typeof prevPrice === "number" && typeof currPrice === "number" && prevPrice > 0 && currPrice > 0) {
        const logReturn = Math.log(currPrice / prevPrice);
        sumReturn += logReturn;
        sumReturnSq += logReturn * logReturn;
        count++;
      }
    }

    let result: number | null = null;

    if (count >= MIN_SAMPLES) {
      const mean = sumReturn / count;
      const variance = sumReturnSq / count - mean * mean;
      result = Math.sqrt(Math.max(0, variance));
    }

    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the volatility regime signal.
   * Ratio > 1 means short-term vol exceeds long-term (breakout regime).
   * Ratio < 1 means contraction (mean-reversion regime).
   * Output normalized to [-1, 1] via tanh(scale * (ratio - 1)).
   */
  public calculate(snapshots: readonly Snapshot[], asset: string): SignalValue {
    const lastIdx = snapshots.length - 1;
    const shortVol = this.computeWindowVolatility(snapshots, asset, lastIdx, SHORT_VOL_WINDOW);
    const longVol = this.computeWindowVolatility(snapshots, asset, lastIdx, LONG_VOL_WINDOW);

    let result: SignalValue = null;

    if (shortVol !== null && longVol !== null && longVol > 0) {
      const ratio = shortVol / longVol;
      result = Math.tanh(REGIME_SCALE * (ratio - 1));
    }

    return result;
  }
}
