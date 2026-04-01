/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section consts
 */

const EXCHANGE_NAMES = ["binance", "coinbase", "kraken", "okx"] as const;
const MIN_EXCHANGE_PRICES = 2;

/**
 * @section types
 */

export type ExchangeWeights = readonly [number, number, number, number];

type ExchangePrice = {
  readonly exchange: string;
  readonly price: number;
  readonly index: number;
};

/**
 * @section class
 */

export class ExchangeWeightedCalculator {
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

  private collectExchangePrices(snap: Snapshot | undefined, asset: string): ExchangePrice[] {
    const prices: ExchangePrice[] = [];

    if (snap) {
      for (let index = 0; index < this.exchanges.length; index += 1) {
        const exchange = this.exchanges[index];

        if (exchange === undefined) {
          continue;
        }

        const price = snap[`${asset}_${exchange}_price`] ?? null;

        if (typeof price === "number") {
          prices.push({ exchange, price, index });
        }
      }
    }

    return prices;
  }

  private weightedAverage(prices: ExchangePrice[], weights: ExchangeWeights): number | null {
    let weightedAverage: number | null = null;

    if (prices.length >= MIN_EXCHANGE_PRICES) {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const priceRow of prices) {
        const weight = weights[priceRow.index] ?? 0;

        if (weight > 0) {
          weightedSum += priceRow.price * weight;
          totalWeight += weight;
        }
      }

      if (totalWeight > 0) {
        weightedAverage = weightedSum / totalWeight;
      }
    }

    return weightedAverage;
  }

  private median(prices: ExchangePrice[]): number | null {
    let median: number | null = null;

    if (prices.length >= MIN_EXCHANGE_PRICES) {
      const sorted = prices.map((priceRow) => priceRow.price).sort((left, right) => left - right);
      const middleIndex = Math.floor(sorted.length / 2);
      median = sorted.length % 2 === 0 ? ((sorted[middleIndex - 1] ?? 0) + (sorted[middleIndex] ?? 0)) / 2 : (sorted[middleIndex] ?? null);
    }

    return median;
  }

  /**
   * @section public:methods
   */

  public calculateConsensus(snapshots: readonly Snapshot[], asset: string, weights?: ExchangeWeights): number | null {
    const snap = snapshots[snapshots.length - 1];
    const prices = this.collectExchangePrices(snap, asset);
    let consensusPrice: number | null = null;

    if (prices.length > 0) {
      consensusPrice = weights !== undefined ? this.weightedAverage(prices, weights) : this.median(prices);
    }

    return consensusPrice;
  }

  public collectPricesAsRecord(snapshots: readonly Snapshot[], asset: string): Record<string, number> {
    const snap = snapshots[snapshots.length - 1];
    const priceRecord: Record<string, number> = {};

    if (snap) {
      for (let index = 0; index < this.exchanges.length; index += 1) {
        const exchange = this.exchanges[index];

        if (exchange === undefined) {
          continue;
        }

        const price = snap[`${asset}_${exchange}_price`] ?? null;

        if (typeof price === "number") {
          priceRecord[exchange] = price;
        }
      }
    }

    return priceRecord;
  }

  public getExchangeName(index: number): string {
    const exchangeName = this.exchanges[index] ?? EXCHANGE_NAMES[index] ?? "unknown";

    return exchangeName;
  }

  public getExchangeCount(): number {
    const exchangeCount = this.exchanges.length;

    return exchangeCount;
  }
}
