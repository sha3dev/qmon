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
 * Minimum number of exchange imbalances required for a meaningful calculation.
 */
const MIN_EXCHANGE_IMBALANCES = 1;

/**
 * @section class
 */
export class SignalImbalance {
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
   * Collect per-exchange imbalance values from the latest snapshot.
   * Skips exchanges where order book data is missing or has empty sides.
   */
  private collectImbalances(snap: Snapshot | undefined, asset: string): Array<{ imbalance: number; index: number }> {
    const imbalances: Array<{ imbalance: number; index: number }> = [];

    if (snap) {
      for (let i = 0; i < this.exchanges.length; i++) {
        const exchange = this.exchanges[i];
        const bookJson = snap[`${asset}_${exchange}_order_book_json`] ?? null;
        const bba = this.bookParser.parseAndBest(typeof bookJson === "string" ? bookJson : null);

        if (bba && bba.bidSize + bba.askSize > 0) {
          const imb = (bba.bidSize - bba.askSize) / (bba.bidSize + bba.askSize);
          imbalances.push({ imbalance: imb, index: i });
        }
      }
    }

    return imbalances;
  }

  /**
   * Compute the weighted average of imbalances.
   */
  private computeWeightedAverage(imbalances: Array<{ imbalance: number; index: number }>, weights: ExchangeWeights): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of imbalances) {
      const weight = weights[item.index] ?? 0;
      if (weight > 0) {
        weightedSum += item.imbalance * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute the median of imbalances.
   */
  private computeMedian(imbalances: Array<{ imbalance: number; index: number }>): number {
    const values = imbalances.map((item) => item.imbalance);
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the aggregated order book imbalance for the underlying asset.
   * Returns the weighted average (if weights provided) or median imbalance
   * across exchanges in [-1, 1], or null.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [-1, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const imbalances = this.collectImbalances(snap, asset);

    if (imbalances.length < MIN_EXCHANGE_IMBALANCES) {
      return null;
    }

    const result = exchangeWeights !== undefined ? this.computeWeightedAverage(imbalances, exchangeWeights) : this.computeMedian(imbalances);

    return result;
  }
}
