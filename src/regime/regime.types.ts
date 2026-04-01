/**
 * @section types
 */

/** Direction regime classification for an asset's price trend. */
export type DirectionRegime = "trending-up" | "trending-down" | "flat";

/** Volatility regime classification based on realized vol ratio. */
export type VolatilityRegime = "high" | "normal" | "low";

/** Severity level for regime change events. */
export type RegimeSeverity = "info" | "warning";

/** Complete regime state for a single asset. */
export type RegimeState = {
  readonly direction: DirectionRegime;
  readonly volatility: VolatilityRegime;
  readonly directionStrength: number; // 0-1, confidence in direction classification
  readonly volatilityLevel: number; // 0-1, normalized volatility level
  readonly lastUpdated: number;
};

/** Event fired when an asset's regime changes. */
export type RegimeEvent = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly severity: RegimeSeverity;
  readonly asset: string;
  readonly regimeType: "direction" | "volatility";
  readonly previous: DirectionRegime | VolatilityRegime;
  readonly current: DirectionRegime | VolatilityRegime;
  readonly firedAt: number;
};

/** Regime state for all assets. */
export type RegimeResult = Record<string, RegimeState>;
