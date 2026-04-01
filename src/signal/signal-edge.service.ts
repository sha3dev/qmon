/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { SignalBookParser } from "./signal-book-parser.service.ts";
import type { SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Scaling factor for edge normalization. An edge of 0.05 (5%) is quite
 * significant in a binary market. tanh(10 * 0.05) ≈ 0.46, tanh(10 * 0.15) ≈ 0.91
 */
const EDGE_SCALE = 10;

/**
 * Steepness for the logistic function used to estimate mechanical Up probability.
 */
const LOGISTIC_STEEPNESS = 1.7;

/**
 * @section class
 */
export class SignalEdge {
  /**
   * @section private:attributes
   */

  private readonly snapshotIntervalMs: number;
  private readonly bookParser: SignalBookParser;

  /**
   * @section constructor
   */

  public constructor(snapshotIntervalMs: number, bookParser: SignalBookParser) {
    this.snapshotIntervalMs = snapshotIntervalMs;
    this.bookParser = bookParser;
  }

  /**
   * @section private:methods
   */

  /**
   * Compute seconds remaining until market end.
   * Handles both numeric (ms timestamp) and string (ISO date) market_end values.
   */
  private computeRemainingSeconds(marketEnd: string | number | null, generatedAt: number | null): number | null {
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
   * Estimate mechanical Up probability using a simplified z-score approach.
   * Uses distance to beat, time remaining, and short-term volatility.
   */
  private estimateModelProbability(snapshots: readonly Snapshot[], snap: Snapshot | undefined, asset: string, window: string): number | null {
    const prefix = `${asset}_${window}`;
    const beat = snap ? (snap[`${prefix}_price_to_beat`] ?? null) : null;
    const chainlinkPrice = snap ? (snap[`${asset}_chainlink_price`] ?? null) : null;
    const marketEnd = snap ? (snap[`${prefix}_market_end`] ?? null) : null;
    const generatedAt = snap ? snap.generated_at : null;

    const distPct = typeof beat === "number" && typeof chainlinkPrice === "number" && beat !== 0 ? (chainlinkPrice - beat) / beat : null;
    const tRem = this.computeRemainingSeconds(marketEnd, generatedAt);
    const sigma = this.estimateVolatility(snapshots, asset);

    let result: number | null = null;

    if (distPct !== null && tRem !== null && tRem > 1 && sigma !== null && sigma > 0) {
      const z = distPct / (sigma * Math.sqrt(tRem));
      result = 1 / (1 + Math.exp(-LOGISTIC_STEEPNESS * z));
    }

    return result;
  }

  /**
   * Extract the market-implied probability of Up from the token order book
   * or displayed price. Prefers the order book mid-price for accuracy.
   */
  private extractMarketProbability(snap: Snapshot | undefined, asset: string, window: string): number | null {
    const prefix = `${asset}_${window}`;
    const bookJson = snap ? (snap[`${prefix}_up_order_book_json`] ?? null) : null;
    const bba = this.bookParser.parseAndBest(typeof bookJson === "string" ? bookJson : null);

    let result: number | null = null;

    if (bba) {
      result = bba.mid;
    } else {
      const displayedPrice = snap ? (snap[`${prefix}_up_price`] ?? null) : null;
      if (typeof displayedPrice === "number") {
        result = displayedPrice;
      }
    }

    return result;
  }

  /**
   * Estimate short-term volatility from Chainlink price log-returns.
   * Minimal implementation — same approach as SignalZScore but self-contained.
   */
  private estimateVolatility(snapshots: readonly Snapshot[], asset: string): number | null {
    const key = `${asset}_chainlink_price`;
    let sumReturn = 0;
    let sumReturnSq = 0;
    let count = 0;

    for (let i = 1; i < snapshots.length; i++) {
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

    if (count >= 20) {
      const mean = sumReturn / count;
      const variance = sumReturnSq / count - mean * mean;
      const perSecondFactor = 1000 / this.snapshotIntervalMs;
      result = Math.sqrt(Math.max(0, variance) * perSecondFactor);
    }

    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the edge between model probability and market-implied probability.
   * Returns a value in [-1, 1] or null when either side is not computable.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, window: string): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const pModel = this.estimateModelProbability(snapshots, snap, asset, window);
    const pMarket = this.extractMarketProbability(snap, asset, window);

    const result = pModel !== null && pMarket !== null ? Math.tanh((pModel - pMarket) * EDGE_SCALE) : null;

    return result;
  }
}
