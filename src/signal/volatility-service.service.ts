/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section consts
 */

const DEFAULT_HISTORY_SIZE = 100;
const MIN_SAMPLES_FOR_PERCENTILE = 20;

/**
 * @section types
 */

type VolatilityPoint = {
  readonly value: number;
  readonly timestamp: number;
};

type VolatilityHistory = {
  readonly asset: string;
  readonly window: string;
  readonly samples: VolatilityPoint[];
  readonly maxSamples: number;
};

/**
 * @section class
 */

/**
 * Computes realized volatility and maintains historical distribution
 * for adaptive threshold normalization using percentiles.
 */
export class VolatilityService {
  /**
   * @section private:attributes
   */

  private volatilityHistories: Map<string, VolatilityHistory>;
  private readonly maxSamples: number;

  /**
   * @section constructor
   */

  public constructor(maxSamples = DEFAULT_HISTORY_SIZE) {
    this.volatilityHistories = new Map();
    this.maxSamples = maxSamples;
  }

  /**
   * @section public:methods
   */

  /**
   * Compute realized volatility from a series of snapshots.
   * Uses standard deviation of log returns normalized by time.
   */
  public computeRealizedVolatility(
    snapshots: readonly Snapshot[],
    asset: string,
    window: string,
    timeframeMinutes = 5,
  ): number | null {
    if (snapshots.length < 2) {
      return null;
    }

    const prices: number[] = [];
    const priceKey = `${asset}_chainlink_price`;

    for (const snapshot of snapshots) {
      const price = snapshot[priceKey];
      if (typeof price === "number" && price > 0) {
        prices.push(price);
      }
    }

    if (prices.length < 2) {
      return null;
    }

    // Compute log returns
    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const priceCurrent = prices[i];
      const pricePrevious = prices[i - 1];
      if (priceCurrent !== undefined && pricePrevious !== undefined && pricePrevious > 0) {
        const logReturn = Math.log(priceCurrent / pricePrevious);
        logReturns.push(logReturn);
      }
    }

    if (logReturns.length === 0) {
      return null;
    }

    // Calculate standard deviation (realized volatility)
    const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / logReturns.length;
    const realizedVolatility = Math.sqrt(variance);

    // Annualize and normalize to 5-minute timeframe
    const normalizedVolatility = realizedVolatility * Math.sqrt(288 * timeframeMinutes);

    // Record in history
    const historyKey = this.getHistoryKey(asset, window);
    this.updateHistory(historyKey, asset, window, normalizedVolatility);

    return normalizedVolatility;
  }

  /**
   * Get volatility percentile (0-1) for current volatility relative to history.
   */
  public getVolatilityPercentile(asset: string, window: string, currentVolatility: number): number | null {
    const history = this.volatilityHistories.get(this.getHistoryKey(asset, window));

    if (history === undefined || history.samples.length < MIN_SAMPLES_FOR_PERCENTILE) {
      return null;
    }

    const allValues = [...history.samples.map((s) => s.value), currentVolatility];
    const rank = allValues.filter((v) => v <= currentVolatility).length;
    const percentile = (rank - 1) / (allValues.length - 1);

    return percentile;
  }

  /**
   * Get adaptive threshold based on volatility percentile.
   * Returns multiplier between 0.5 and 2.0 based on volatility regime.
   */
  public getAdaptiveThresholdMultiplier(asset: string, window: string, currentVolatility: number): number {
    const percentile = this.getVolatilityPercentile(asset, window, currentVolatility);

    if (percentile === null) {
      return 1.0; // Default multiplier if insufficient history
    }

    // Low volatility (< 30th percentile): tighter thresholds
    if (percentile < 0.3) {
      return 0.5 + (percentile / 0.3) * 0.3; // 0.5 to 0.8
    }

    // High volatility (> 70th percentile): wider thresholds
    if (percentile > 0.7) {
      return 1.0 + ((percentile - 0.7) / 0.3) * 1.0; // 1.0 to 2.0
    }

    // Normal volatility: baseline multiplier
    return 1.0;
  }

  /**
   * Get adaptive minimum edge BPS based on current volatility.
   */
  public getAdaptiveMinEdgeBps(asset: string, window: string, currentVolatility: number, baseMinEdgeBps = 35): number {
    const multiplier = this.getAdaptiveThresholdMultiplier(asset, window, currentVolatility);
    const adaptiveMinEdgeBps = baseMinEdgeBps * multiplier;

    // Clamp to reasonable range
    return Math.max(15, Math.min(100, adaptiveMinEdgeBps));
  }

  /**
   * Check if current volatility is in a high regime (> 70th percentile).
   */
  public isHighVolatilityRegime(asset: string, window: string, currentVolatility: number): boolean {
    const percentile = this.getVolatilityPercentile(asset, window, currentVolatility);
    return percentile !== null && percentile > 0.7;
  }

  /**
   * Check if current volatility is in a low regime (< 30th percentile).
   */
  public isLowVolatilityRegime(asset: string, window: string, currentVolatility: number): boolean {
    const percentile = this.getVolatilityPercentile(asset, window, currentVolatility);
    return percentile !== null && percentile < 0.3;
  }

  /**
   * Clear all volatility history.
   */
  public clear(): void {
    this.volatilityHistories.clear();
  }

  /**
   * @section private:methods
   */

  private getHistoryKey(asset: string, window: string): string {
    return `${asset}-${window}`;
  }

  private updateHistory(key: string, asset: string, window: string, value: number): void {
    let history = this.volatilityHistories.get(key);

    if (history === undefined) {
      history = {
        asset,
        window,
        samples: [],
        maxSamples: this.maxSamples,
      };
      this.volatilityHistories.set(key, history);
    }

    const point: VolatilityPoint = {
      value,
      timestamp: Date.now(),
    };

    // Maintain circular buffer
    if (history.samples.length >= history.maxSamples) {
      history.samples.shift();
    }

    history.samples.push(point);
  }
}
