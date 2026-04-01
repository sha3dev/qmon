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
 * Scaling factor for tanh normalization of spread.
 * A spread of 0.1% (tight for crypto) maps to tanh(100 * 0.001) ≈ 0.1.
 * A spread of 1% (wide) maps to tanh(100 * 0.01) ≈ 0.76.
 */
const SPREAD_SCALE = 100;

/**
 * Minimum number of exchange spreads required.
 */
const MIN_EXCHANGE_SPREADS = 1;

/**
 * @section class
 */
export class SignalSpread {
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
   * Collect spread percentages from each exchange with their indices.
   * Spread is expressed as a fraction of mid price.
   */
  private collectSpreads(snap: Snapshot | undefined, asset: string): Array<{ spreadPct: number; index: number }> {
    const spreads: Array<{ spreadPct: number; index: number }> = [];

    if (snap) {
      for (let i = 0; i < this.exchanges.length; i++) {
        const exchange = this.exchanges[i];
        const bookJson = snap[`${asset}_${exchange}_order_book_json`] ?? null;
        const bba = this.bookParser.parseAndBest(typeof bookJson === "string" ? bookJson : null);

        if (bba && bba.mid > 0) {
          spreads.push({ spreadPct: bba.spread / bba.mid, index: i });
        }
      }
    }

    return spreads;
  }

  /**
   * Compute the weighted average of spread percentages.
   */
  private computeWeightedAverage(spreads: Array<{ spreadPct: number; index: number }>, weights: ExchangeWeights): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of spreads) {
      const weight = weights[item.index] ?? 0;
      if (weight > 0) {
        weightedSum += item.spreadPct * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute the simple average of spread percentages.
   */
  private computeAverage(spreads: Array<{ spreadPct: number; index: number }>): number {
    if (spreads.length === 0) return 0;
    const sum = spreads.reduce((acc, item) => acc + item.spreadPct, 0);
    return sum / spreads.length;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the normalized spread signal.
   * Output is in [0, 1]: near 0 = tight spread (confident/liquid),
   * near 1 = wide spread (uncertain/illiquid).
   * When exchangeWeights are provided, uses weighted average.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [0, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const spreads = this.collectSpreads(snap, asset);

    if (spreads.length < MIN_EXCHANGE_SPREADS) {
      return null;
    }

    const avgSpread = exchangeWeights !== undefined ? this.computeWeightedAverage(spreads, exchangeWeights) : this.computeAverage(spreads);

    const result = Math.tanh(avgSpread * SPREAD_SCALE);
    return result;
  }
}
