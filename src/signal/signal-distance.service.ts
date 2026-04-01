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
 * Scaling factor for tanh normalization. Tuned so that a ~0.5% distance
 * maps to roughly ±0.5 signal strength. tanh(50 * 0.005) ≈ 0.245,
 * tanh(50 * 0.01) ≈ 0.462, tanh(50 * 0.05) ≈ 0.986.
 */
const DISTANCE_SCALE = 50;

/**
 * @section class
 */
export class SignalDistance {
  /**
   * @section public:methods
   */

  /**
   * Calculate the signed distance between Chainlink price and Price to Beat.
   * Returns a value in [-1, 1] via tanh normalization, or null if inputs are missing.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, window: string): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const prefix = `${asset}_${window}`;
    const beat = snap ? snap[`${prefix}_price_to_beat`] : null;
    const chainlinkPrice = snap ? snap[`${asset}_chainlink_price`] : null;

    const result =
      typeof beat === "number" && typeof chainlinkPrice === "number" && beat !== 0 ? Math.tanh(((chainlinkPrice - beat) / beat) * DISTANCE_SCALE) : null;

    return result;
  }
}
