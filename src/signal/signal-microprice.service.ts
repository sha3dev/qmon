/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { SignalBookParser } from "./signal-book-parser.service.ts";
import type { ExchangeWeights } from "./signal-exchange-weighted-calculator.service.ts";
import type { SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Scaling factor for the microprice-to-mid deviation.
 * A microprice deviation of 0.01% is significant at the top-of-book level.
 * tanh(5000 * 0.0001) ≈ 0.46, tanh(5000 * 0.0005) ≈ 0.97
 */
const MICROPRICE_SCALE = 5000;

/**
 * Minimum number of exchange deviations required for a meaningful calculation.
 */
const MIN_EXCHANGE_DEVIATIONS = 1;

/**
 * @section class
 */
export class SignalMicroprice {
  /**
   * @section private:attributes
   */

  private readonly exchanges: readonly string[];
  private readonly bookParser: SignalBookParser;

  /**
   * @section constructor
   */

  public constructor(exchanges: readonly string[], bookParser: SignalBookParser) {
    this.exchanges = exchanges;
    this.bookParser = bookParser;
  }

  /**
   * @section private:methods
   */

  /**
   * Collect microprice deviations from each exchange's order book.
   * Each deviation is already tanh-normalized to [-1, 1].
   */
  private collectDeviations(snap: Snapshot | undefined, asset: string): Array<{ deviation: number; index: number }> {
    const deviations: Array<{ deviation: number; index: number }> = [];

    if (snap) {
      for (let i = 0; i < this.exchanges.length; i++) {
        const exchange = this.exchanges[i];
        const bookJson = snap[`${asset}_${exchange}_order_book_json`] ?? null;
        const bba = this.bookParser.parseAndBest(typeof bookJson === "string" ? bookJson : null);

        if (bba && bba.mid > 0 && bba.bidSize + bba.askSize > 0) {
          const microprice = (bba.askPrice * bba.bidSize + bba.bidPrice * bba.askSize) / (bba.bidSize + bba.askSize);
          const deviationPct = (microprice - bba.mid) / bba.mid;
          deviations.push({ deviation: Math.tanh(deviationPct * MICROPRICE_SCALE), index: i });
        }
      }
    }

    return deviations;
  }

  /**
   * Compute the weighted average of deviations.
   */
  private computeWeightedAverage(deviations: Array<{ deviation: number; index: number }>, weights: ExchangeWeights): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of deviations) {
      const weight = weights[item.index] ?? 0;
      if (weight > 0) {
        weightedSum += item.deviation * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute the median of deviations.
   */
  private computeMedian(deviations: Array<{ deviation: number; index: number }>): number {
    const values = deviations.map((item) => item.deviation);
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the aggregated microprice deviation for the underlying asset.
   * Returns the weighted average (if weights provided) or median deviation
   * across exchanges in [-1, 1], or null.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [-1, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const deviations = this.collectDeviations(snap, asset);

    if (deviations.length < MIN_EXCHANGE_DEVIATIONS) {
      return null;
    }

    const result = exchangeWeights !== undefined ? this.computeWeightedAverage(deviations, exchangeWeights) : this.computeMedian(deviations);

    return result;
  }
}
