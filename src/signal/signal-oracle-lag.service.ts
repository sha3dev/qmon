/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { ExchangeWeights } from "./signal-exchange-weighted-calculator.service.ts";
import { ExchangeWeightedCalculator } from "./signal-exchange-weighted-calculator.service.ts";
import type { SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Scaling factor for tanh normalization of the oracle-exchange lag.
 * A 0.1% lag is quite meaningful in short windows.
 * tanh(200 * 0.001) ≈ 0.197, tanh(200 * 0.005) ≈ 0.762
 */
const LAG_SCALE = 200;

/**
 * @section class
 */
export class SignalOracleLag {
  /**
   * @section private:attributes
   */

  private readonly calculator: ExchangeWeightedCalculator;

  /**
   * @section constructor
   */

  public constructor(exchanges: readonly string[]) {
    this.calculator = new ExchangeWeightedCalculator(exchanges);
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate the oracle-vs-exchange lag for the given asset.
   * Returns a value in [-1, 1] or null if data is insufficient.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Optional exchange weights [binance, coinbase, kraken, okx]
   * @returns Signal value in [-1, 1] or null
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, exchangeWeights?: ExchangeWeights): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const chainlinkPrice = snap ? (snap[`${asset}_chainlink_price`] ?? null) : null;
    const consensus = this.calculator.calculateConsensus(snapshots, asset, exchangeWeights);

    const result =
      typeof chainlinkPrice === "number" && chainlinkPrice !== 0 && consensus !== null
        ? Math.tanh(((consensus - chainlinkPrice) / chainlinkPrice) * LAG_SCALE)
        : null;

    return result;
  }
}
