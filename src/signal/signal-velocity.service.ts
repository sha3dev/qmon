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
 * Scaling factor for tanh normalization of velocity.
 * Tuned so that a velocity of ~$1/s for BTC (~$60k) maps to moderate signal.
 * Per-second price change of $1 at $60k ≈ 0.0017% → tanh(500 * 0.0017%) ≈ 0.008
 * Per-second price change of $50 at $60k ≈ 0.083% → tanh(500 * 0.00083) ≈ 0.4
 */
const VELOCITY_SCALE = 500;

/**
 * Maximum allowed timestamp deviation (ms) between expected and actual
 * snapshot timestamps when using index-based lookback.
 */
const MAX_TIMESTAMP_DRIFT_MS = 100;

/**
 * @section class
 */
export class SignalVelocity {
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
   * Compute velocity for a single horizon using O(1) index-based lookback.
   * Validates the timestamp at the lookback index to ensure data integrity.
   */
  private velocityAtHorizon(snapshots: readonly Snapshot[], asset: string, horizonSec: number): SignalValue {
    const indexOffset = Math.round((horizonSec * 1000) / this.snapshotIntervalMs);
    const currentIdx = snapshots.length - 1;
    const lookbackIdx = currentIdx - indexOffset;

    let result: SignalValue = null;

    if (lookbackIdx >= 0) {
      const current = snapshots[currentIdx];
      const previous = snapshots[lookbackIdx];
      const isTimestampValid = this.validateTimestamp(current, previous, indexOffset);

      if (isTimestampValid) {
        const key = `${asset}_chainlink_price`;
        const currPrice = current ? (current[key] ?? null) : null;
        const prevPrice = previous ? (previous[key] ?? null) : null;

        if (typeof currPrice === "number" && typeof prevPrice === "number" && prevPrice !== 0) {
          const velocityPct = (currPrice - prevPrice) / prevPrice;
          result = Math.tanh(velocityPct * VELOCITY_SCALE);
        }
      }
    }

    return result;
  }

  /**
   * Validate that the timestamp difference between two snapshots matches
   * the expected offset within tolerance. Returns false if either snapshot
   * is missing or timestamps diverge beyond MAX_TIMESTAMP_DRIFT_MS.
   */
  private validateTimestamp(current: Snapshot | undefined, previous: Snapshot | undefined, indexOffset: number): boolean {
    let isValid = false;

    if (current && previous) {
      const expectedDiffMs = indexOffset * this.snapshotIntervalMs;
      const actualDiffMs = current.generated_at - previous.generated_at;
      /** Scale tolerance with horizon length to account for cumulative setInterval jitter. */
      const tolerance = Math.max(MAX_TIMESTAMP_DRIFT_MS, expectedDiffMs * 0.01);
      isValid = Math.abs(actualDiffMs - expectedDiffMs) <= tolerance;
    }

    return isValid;
  }

  /**
   * Convert a horizon in seconds to a human-readable label (e.g. 30 → "30s", 120 → "2m").
   */
  private horizonLabel(horizonSec: number): string {
    const result = horizonSec >= 60 ? `${Math.round(horizonSec / 60)}m` : `${horizonSec}s`;
    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate velocity at each configured horizon for the given asset.
   * Returns an object keyed by horizon label with values in [-1, 1].
   */
  public calculate(snapshots: readonly Snapshot[], asset: string): HorizonSignalValues {
    const result: Record<string, SignalValue> = {};

    for (let h = 0; h < this.horizonsSec.length; h++) {
      const horizon = this.horizonsSec[h];
      if (horizon !== undefined) {
        const label = this.horizonLabel(horizon);
        result[label] = this.velocityAtHorizon(snapshots, asset, horizon);
      }
    }

    return result;
  }
}
