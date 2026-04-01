/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { ExchangeWeights } from "./signal-exchange-weighted-calculator.service.ts";
import type { SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Scaling factor for tanh normalization. A 0.1% spread between exchanges
 * is quite normal; 0.5% or more indicates real uncertainty.
 * tanh(100 * 0.001) ≈ 0.10, tanh(100 * 0.005) ≈ 0.46, tanh(100 * 0.01) ≈ 0.76
 */
const DISPERSION_SCALE = 100;

/**
 * Minimum exchange prices required to compute a meaningful dispersion.
 */
const MIN_EXCHANGE_PRICES = 2;

/**
 * @section class
 */
export class SignalDispersion {
  /**
   * @section private:attributes
   */

  private readonly exchanges: readonly string[];

  /**
   * @section constructor
   */

  public constructor(exchanges: readonly string[]) {
    this.exchanges = exchanges;
  }

  /**
   * @section private:methods
   */

  /**
   * Collect exchange prices with their indices for weighted calculations.
   */
  private collectExchangePrices(snap: Snapshot | undefined, asset: string): Array<{ price: number; index: number }> {
    const prices: Array<{ price: number; index: number }> = [];

    if (snap) {
      for (let i = 0; i < this.exchanges.length; i++) {
        const exchange = this.exchanges[i];
        const price = snap[`${asset}_${exchange}_price`] ?? null;
        if (typeof price === "number") {
          prices.push({ price, index: i });
        }
      }
    }

    return prices;
  }

  /**
   * Calculate weighted average of exchange prices.
   */
  private calculateWeightedAverage(prices: Array<{ price: number; index: number }>, weights: ExchangeWeights): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const p of prices) {
      const weight = weights[p.index] ?? 0;
      if (weight > 0) {
        weightedSum += p.price * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate price dispersion across exchanges for the given asset.
   * Returns a value in [0, 1] or null if data is insufficient.
   * When exchangeWeights are provided, uses them to calculate the consensus reference point.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [0, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const prices = this.collectExchangePrices(snap, asset);

    let result: SignalValue = null;

    if (prices.length >= MIN_EXCHANGE_PRICES) {
      let min = prices[0]?.price ?? 0;
      let max = prices[0]?.price ?? 0;

      for (const p of prices) {
        if (p.price < min) min = p.price;
        if (p.price > max) max = p.price;
      }

      // Use weighted average if weights provided, otherwise use simple average
      const consensus =
        exchangeWeights !== undefined ? this.calculateWeightedAverage(prices, exchangeWeights) : prices.reduce((sum, p) => sum + p.price, 0) / prices.length;

      if (consensus > 0) {
        const rangePct = (max - min) / consensus;
        result = Math.tanh(rangePct * DISPERSION_SCALE);
      }
    }

    return result;
  }
}
