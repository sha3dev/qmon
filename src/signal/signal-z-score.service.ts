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
 * Steepness of the logistic curve used to convert the z-score into a
 * directional probability. Higher values make the curve sharper near zero.
 * 1.7 approximates the probit-to-logistic mapping commonly used in quant finance.
 */
const LOGISTIC_STEEPNESS = 1.7;

/**
 * Minimum seconds remaining before we consider the z-score meaningful.
 * Avoids division by near-zero sqrt(tRem).
 */
const MIN_REMAINING_SEC = 1;

/**
 * Minimum number of return observations required to estimate volatility.
 * With 500ms snapshots, 20 observations = 10 seconds of history.
 */
const MIN_VOLATILITY_SAMPLES = 20;

/**
 * @section class
 */
export class SignalZScore {
  /**
   * @section private:attributes
   */

  private readonly snapshotIntervalMs: number;

  /**
   * @section constructor
   */

  public constructor(snapshotIntervalMs: number) {
    this.snapshotIntervalMs = snapshotIntervalMs;
  }

  /**
   * @section private:methods
   */

  /**
   * Compute seconds remaining until market end.
   * Returns null if market_end is not a valid ISO string or generatedAt is missing.
   */
  private computeRemainingSeconds(marketEnd: string | number | null, generatedAt: number | string | null): number | null {
    let result: number | null = null;

    if (typeof generatedAt === "number") {
      if (typeof marketEnd === "number") {
        result = (marketEnd - generatedAt) / 1000;
      } else {
        if (typeof marketEnd === "string") {
          const endMs = Date.parse(marketEnd);
          if (Number.isFinite(endMs)) {
            result = (endMs - generatedAt) / 1000;
          }
        }
      }
    }

    return result;
  }

  /**
   * Estimate short-term volatility as the standard deviation of per-snapshot
   * log-returns of the Chainlink price. Uses all available snapshots for maximum
   * accuracy. Returns null if fewer than MIN_VOLATILITY_SAMPLES returns exist.
   *
   * Performance: single pass to collect returns, then one pass for mean + variance.
   */
  private computeVolatility(snapshots: readonly Snapshot[], asset: string): number | null {
    const key = `${asset}_chainlink_price`;
    const returns: number[] = [];

    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      const prevPrice = prev ? prev[key] : null;
      const currPrice = curr ? curr[key] : null;

      if (typeof prevPrice === "number" && typeof currPrice === "number" && prevPrice > 0 && currPrice > 0) {
        returns.push(Math.log(currPrice / prevPrice));
      }
    }

    let result: number | null = null;

    if (returns.length >= MIN_VOLATILITY_SAMPLES) {
      let sum = 0;
      for (let i = 0; i < returns.length; i++) {
        sum += returns[i] ?? 0;
      }
      const mean = sum / returns.length;

      let sumSq = 0;
      for (let i = 0; i < returns.length; i++) {
        const diff = (returns[i] ?? 0) - mean;
        sumSq += diff * diff;
      }

      const variance = sumSq / returns.length;
      /** Convert per-snapshot vol to per-second vol */
      const perSecondFactor = 1000 / this.snapshotIntervalMs;
      result = Math.sqrt(variance * perSecondFactor);
    }

    return result;
  }

  /**
   * Convert distance percentage, volatility, and time remaining into a
   * normalized [-1, 1] signal via the logistic function.
   */
  private zScoreToSignal(distPct: number, sigma: number, tRem: number): number {
    const z = distPct / (sigma * Math.sqrt(tRem));
    const pUp = 1 / (1 + Math.exp(-LOGISTIC_STEEPNESS * z));
    const result = 2 * pUp - 1;
    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the time-and-volatility-adjusted z-score for a given asset and window.
   * Returns a value in [-1, 1] or null when inputs are insufficient.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, window: string): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const prefix = `${asset}_${window}`;
    const beat = snap ? (snap[`${prefix}_price_to_beat`] ?? null) : null;
    const chainlinkPrice = snap ? (snap[`${asset}_chainlink_price`] ?? null) : null;
    const marketEnd = snap ? (snap[`${prefix}_market_end`] ?? null) : null;
    const generatedAt = snap ? snap.generated_at : null;

    const tRem = this.computeRemainingSeconds(marketEnd, generatedAt);
    const sigmaShort = this.computeVolatility(snapshots, asset);
    const distPct = typeof beat === "number" && typeof chainlinkPrice === "number" && beat !== 0 ? (chainlinkPrice - beat) / beat : null;

    const isComputable = distPct !== null && sigmaShort !== null && sigmaShort > 0 && tRem !== null && tRem >= MIN_REMAINING_SEC;

    const result = isComputable ? this.zScoreToSignal(distPct, sigmaShort, tRem) : null;

    return result;
  }
}
