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
 * Ratio of fast EMA span to slow EMA span.
 * Fast span = slow span / FAST_RATIO. A ratio of 6 gives classic
 * short/long EMA pairs (e.g., 5s/30s, 20s/2m, 50s/5m).
 */
const FAST_RATIO = 6;

/**
 * Scaling factor for tanh normalization of the EMA crossover signal.
 * Tuned so a 0.05% EMA crossover divergence maps to moderate signal.
 */
const MOMENTUM_SCALE = 800;

/**
 * @section class
 */
export class SignalMomentum {
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
   * Compute EMA over the snapshot price series for the given asset.
   * Returns null if no valid prices exist.
   */
  private computeEma(snapshots: readonly Snapshot[], asset: string, alpha: number): number | null {
    const key = `${asset}_chainlink_price`;
    let ema: number | null = null;

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const price = snap ? (snap[key] ?? null) : null;

      if (typeof price === "number") {
        if (ema === null) {
          ema = price;
        } else {
          ema = alpha * price + (1 - alpha) * ema;
        }
      }
    }

    return ema;
  }

  /**
   * Calculate momentum for a single horizon using EMA crossover.
   * The slow EMA span maps to the horizon duration; fast is slow / FAST_RATIO.
   */
  private momentumAtHorizon(snapshots: readonly Snapshot[], asset: string, horizonSec: number): SignalValue {
    const slowSpan = Math.round((horizonSec * 1000) / this.snapshotIntervalMs);
    const fastSpan = Math.max(2, Math.round(slowSpan / FAST_RATIO));
    const slowAlpha = 2 / (slowSpan + 1);
    const fastAlpha = 2 / (fastSpan + 1);

    const fastEma = this.computeEma(snapshots, asset, fastAlpha);
    const slowEma = this.computeEma(snapshots, asset, slowAlpha);

    let result: SignalValue = null;

    if (fastEma !== null && slowEma !== null && slowEma !== 0) {
      const crossoverPct = (fastEma - slowEma) / slowEma;
      result = Math.tanh(crossoverPct * MOMENTUM_SCALE);
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
   * Calculate EMA crossover momentum at each configured horizon.
   * Returns an object keyed by horizon label with values in [-1, 1].
   */
  public calculate(snapshots: readonly Snapshot[], asset: string): HorizonSignalValues {
    const result: Record<string, SignalValue> = {};

    for (let h = 0; h < this.horizonsSec.length; h++) {
      const horizon = this.horizonsSec[h];
      if (horizon !== undefined) {
        const label = this.horizonLabel(horizon);
        result[label] = this.momentumAtHorizon(snapshots, asset, horizon);
      }
    }

    return result;
  }
}
