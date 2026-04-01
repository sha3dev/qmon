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
 * Baseline depth in quote units for normalization.
 * Depth equal to this value maps to tanh(1) ≈ 0.76.
 * Calibrated for typical crypto exchange order books.
 */
const BASELINE_DEPTH = 50;

/**
 * Minimum number of exchange depths required.
 */
const MIN_EXCHANGE_DEPTHS = 1;

/**
 * @section class
 */
export class SignalBookDepth {
  /**
   * @section private:attributes
   */

  private readonly bookParser: SignalBookParser;
  private readonly exchanges: readonly string[];

  /**
   * @section constructor
   */

  public constructor(bookParser: SignalBookParser, exchanges: readonly string[]) {
    this.bookParser = bookParser;
    this.exchanges = exchanges;
  }

  /**
   * @section private:methods
   */

  /**
   * Collect depth values (bid size + ask size) from each exchange with their indices.
   */
  private collectDepths(snap: Snapshot | undefined, asset: string): Array<{ depth: number; index: number }> {
    const depths: Array<{ depth: number; index: number }> = [];

    if (snap) {
      for (let i = 0; i < this.exchanges.length; i++) {
        const exchange = this.exchanges[i];
        const bookJson = snap[`${asset}_${exchange}_order_book_json`] ?? null;
        const bba = this.bookParser.parseAndBest(typeof bookJson === "string" ? bookJson : null);

        if (bba) {
          depths.push({ depth: bba.bidSize + bba.askSize, index: i });
        }
      }
    }

    return depths;
  }

  /**
   * Compute the weighted average of depth values.
   */
  private computeWeightedAverage(depths: Array<{ depth: number; index: number }>, weights: ExchangeWeights): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of depths) {
      const weight = weights[item.index] ?? 0;
      if (weight > 0) {
        weightedSum += item.depth * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute the simple average of depth values.
   */
  private computeAverage(depths: Array<{ depth: number; index: number }>): number {
    if (depths.length === 0) return 0;
    const sum = depths.reduce((acc, item) => acc + item.depth, 0);
    return sum / depths.length;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the normalized book depth signal.
   * Output is in [0, 1]: near 0 = thin book (fragile price),
   * near 1 = deep book (stable/liquid).
   * When exchangeWeights are provided, uses weighted average.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [0, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const depths = this.collectDepths(snap, asset);

    if (depths.length < MIN_EXCHANGE_DEPTHS) {
      return null;
    }

    const avgDepth = exchangeWeights !== undefined ? this.computeWeightedAverage(depths, exchangeWeights) : this.computeAverage(depths);

    const result = Math.tanh(avgDepth / BASELINE_DEPTH);
    return result;
  }
}
