/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { HorizonSignalValues, SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Minimum samples required to compute a meaningful standard deviation.
 */
const MIN_SAMPLES = 20;

/**
 * Maximum Bollinger band z-value before clamping.
 * Prevents extreme outliers from saturating the tanh output.
 */
const MAX_Z = 4;

/**
 * @section class
 */
export class SignalMeanReversion {
  /**
   * @section private:attributes
   */

  private readonly snapshotIntervalMs: number;
  private readonly horizonsSec: readonly number[];

  /**
   * @section constructor
   */

  public constructor(snapshotIntervalMs: number, horizonsSec: readonly number[]) {
    this.snapshotIntervalMs = snapshotIntervalMs;
    this.horizonsSec = horizonsSec;
  }

  /**
   * @section private:methods
   */

  /**
   * Compute rolling mean and standard deviation of the Chainlink price
   * over a trailing window of the given size. Returns null if insufficient data.
   */
  private computeRollingStats(snapshots: readonly Snapshot[], asset: string, windowSize: number): { mean: number; stdev: number } | null {
    const key = `${asset}_chainlink_price`;
    const startIdx = Math.max(0, snapshots.length - windowSize);
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let i = startIdx; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const price = snap ? (snap[key] ?? null) : null;

      if (typeof price === "number") {
        sum += price;
        sumSq += price * price;
        count++;
      }
    }

    let result: { mean: number; stdev: number } | null = null;

    if (count >= MIN_SAMPLES) {
      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      result = { mean, stdev: Math.sqrt(Math.max(0, variance)) };
    }

    return result;
  }

  /**
   * Calculate mean reversion at a single horizon.
   */
  private revertAtHorizon(snapshots: readonly Snapshot[], asset: string, horizonSec: number): SignalValue {
    const windowSize = Math.round((horizonSec * 1000) / this.snapshotIntervalMs);
    const snap = snapshots[snapshots.length - 1];
    const key = `${asset}_chainlink_price`;
    const price = snap ? (snap[key] ?? null) : null;
    const stats = this.computeRollingStats(snapshots, asset, windowSize);

    let result: SignalValue = null;

    if (typeof price === "number" && stats !== null && stats.stdev > 0) {
      const rawZ = (price - stats.mean) / stats.stdev;
      const clampedZ = Math.max(-MAX_Z, Math.min(MAX_Z, rawZ));
      /** Divide by 2 so tanh input stays in a useful range */
      result = Math.tanh(clampedZ / 2);
    }

    return result;
  }

  /**
   * Convert a horizon in seconds to a human-readable label.
   */
  private horizonLabel(horizonSec: number): string {
    const result = horizonSec >= 60 ? `${Math.round(horizonSec / 60)}m` : `${horizonSec}s`;
    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate mean reversion signal at each configured horizon.
   * Positive when price is above the rolling mean (overextended up),
   * negative when below (overextended down).
   * Output normalized to [-1, 1] via tanh. Acts as counter-trend indicator.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string): HorizonSignalValues {
    const result: Record<string, SignalValue> = {};

    for (let h = 0; h < this.horizonsSec.length; h++) {
      const horizon = this.horizonsSec[h];
      if (horizon !== undefined) {
        const label = this.horizonLabel(horizon);
        result[label] = this.revertAtHorizon(snapshots, asset, horizon);
      }
    }

    return result;
  }
}
