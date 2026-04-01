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
 * Scaling factor for the lead-lag normalization.
 * A 2-second lag at 5m windows is very significant.
 * tanh(0.5 * 2000) would saturate, so we scale by milliseconds.
 * tanh(0.001 * 500) ≈ 0.46, tanh(0.001 * 2000) ≈ 0.96
 */
const STALENESS_SCALE = 0.001;

/**
 * Minimum number of exchange staleness values required.
 */
const MIN_EXCHANGE_STALENESS = 1;

/**
 * @section class
 */
export class SignalStaleness {
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
   * Compute staleness in milliseconds for a single event timestamp field.
   * Returns null if the event timestamp or generated_at is missing.
   */
  private computeStaleness(snap: Snapshot | undefined, eventTsKey: string, generatedAt: number | null): number | null {
    const eventTs = snap ? (snap[eventTsKey] ?? null) : null;
    const result = typeof eventTs === "number" && typeof generatedAt === "number" ? generatedAt - eventTs : null;
    return result;
  }

  /**
   * Compute staleness values across all available exchange feeds with their indices.
   */
  private collectExchangeStaleness(snap: Snapshot | undefined, asset: string, generatedAt: number | null): Array<{ staleness: number; index: number }> {
    const stalenessValues: Array<{ staleness: number; index: number }> = [];

    if (snap && typeof generatedAt === "number") {
      for (let i = 0; i < this.exchanges.length; i++) {
        const exchange = this.exchanges[i];
        const eventTs = snap[`${asset}_${exchange}_event_ts`] ?? null;
        if (typeof eventTs === "number") {
          stalenessValues.push({ staleness: generatedAt - eventTs, index: i });
        }
      }
    }

    return stalenessValues;
  }

  /**
   * Compute the weighted average of exchange staleness values.
   */
  private computeWeightedAverage(stalenessValues: Array<{ staleness: number; index: number }>, weights: ExchangeWeights): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of stalenessValues) {
      const weight = weights[item.index] ?? 0;
      if (weight > 0) {
        weightedSum += item.staleness * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Compute the median of exchange staleness values.
   */
  private computeMedian(stalenessValues: Array<{ staleness: number; index: number }>): number {
    const values = stalenessValues.map((item) => item.staleness);
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the lead-lag indicator between Chainlink and exchange feeds.
   * Returns a value in [-1, 1] or null when timestamps are missing.
   * When exchangeWeights are provided, uses weighted average of exchange staleness.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [-1, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const generatedAt = snap ? snap.generated_at : null;
    const chainlinkStaleness = this.computeStaleness(snap, `${asset}_chainlink_event_ts`, generatedAt);
    const exchangeStalenessValues = this.collectExchangeStaleness(snap, asset, generatedAt);

    let result: SignalValue = null;

    if (chainlinkStaleness !== null && exchangeStalenessValues.length >= MIN_EXCHANGE_STALENESS) {
      const exchangeStaleness =
        exchangeWeights !== undefined ? this.computeWeightedAverage(exchangeStalenessValues, exchangeWeights) : this.computeMedian(exchangeStalenessValues);

      // Positive means Chainlink is older than exchanges → Chainlink lags
      const leadLag = chainlinkStaleness - exchangeStaleness;
      result = Math.tanh(leadLag * STALENESS_SCALE);
    }

    return result;
  }
}
