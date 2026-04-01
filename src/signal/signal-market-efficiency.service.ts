/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { SignalValue } from "./signal.types.ts";

/**
 * @section consts
 */

/**
 * Scaling factor for tanh normalization of efficiency deviation.
 * A 2% deviation from 1.0 maps to tanh(20 * 0.02) ≈ 0.38.
 * A 10% deviation maps to tanh(20 * 0.10) ≈ 0.96.
 */
const EFFICIENCY_SCALE = 20;

/**
 * @section class
 */
export class SignalMarketEfficiency {
  /**
   * @section public:methods
   */

  /**
   * Calculate the market efficiency signal.
   * Measures deviation of (up_price + down_price) from 1.0.
   * Positive = overpriced (sum > 1), negative = underpriced (sum < 1).
   * Near zero = efficient market. Output in [-1, 1] via tanh.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, window: string): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const prefix = `${asset}_${window}`;
    const upPrice = snap ? (snap[`${prefix}_up_displayed_price`] ?? null) : null;
    /**
     * Down price can be stored explicitly or inferred as (1 - upPrice).
     * Try the explicit field first, then fall back to the complement.
     */
    const downPriceRaw = snap ? (snap[`${prefix}_down_displayed_price`] ?? null) : null;
    const downPrice = typeof downPriceRaw === "number" ? downPriceRaw : typeof upPrice === "number" ? 1 - upPrice : null;

    let result: SignalValue = null;

    if (typeof upPrice === "number" && typeof downPrice === "number") {
      const deviation = upPrice + downPrice - 1;
      result = Math.tanh(deviation * EFFICIENCY_SCALE);
    }

    return result;
  }
}
