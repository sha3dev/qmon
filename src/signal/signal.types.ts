/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section types
 */

/** Re-export Snapshot so consumers import from the signal feature entrypoint */
export type { Snapshot };

/** A single signal value normalized to [-1, 1], or null when not computable */
export type SignalValue = number | null;

/** Signal values keyed by horizon label (e.g. "30s", "2m", "5m") */
export type HorizonSignalValues = Record<string, SignalValue>;

/** Parsed order book price level */
export type BookLevel = {
  readonly price: number;
  readonly size: number;
};

/** Parsed order book with bid and ask sides */
export type ParsedBook = {
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
};

/** Best bid/ask summary extracted from a parsed order book */
export type BestBidAsk = {
  readonly bidPrice: number;
  readonly bidSize: number;
  readonly askPrice: number;
  readonly askSize: number;
  readonly mid: number;
  readonly spread: number;
};

/**
 * Window-level signals that depend on market window fields
 * (price_to_beat, market_end, up/down tokens).
 */
export type WindowSignals = {
  readonly distance: SignalValue;
  readonly zScore: SignalValue;
  readonly edge: SignalValue;
  readonly tokenPressure: SignalValue;
  readonly marketEfficiency: SignalValue;
};

/** Price and timing data extracted from the latest snapshot for display purposes */
export type WindowPriceData = {
  readonly priceToBeat: number | null;
  readonly upPrice: number | null;
  readonly downPrice: number | null;
  readonly marketStartMs: number | null;
  readonly marketEndMs: number | null;
};

/**
 * Asset-level signals that are independent of market window.
 * Computed once per asset and shared across windows.
 */
export type AssetSignals = {
  readonly velocity: HorizonSignalValues;
  readonly momentum: HorizonSignalValues;
  readonly meanReversion: HorizonSignalValues;
  readonly oracleLag: SignalValue;
  readonly dispersion: SignalValue;
  readonly imbalance: SignalValue;
  readonly microprice: SignalValue;
  readonly staleness: SignalValue;
  readonly acceleration: SignalValue;
  readonly volatilityRegime: SignalValue;
  readonly spread: SignalValue;
  readonly bookDepth: SignalValue;
  readonly crossAssetMomentum: SignalValue;
};

/** Structured window result with signals and price data */
export type WindowResult = {
  readonly signals: WindowSignals;
  readonly prices: WindowPriceData;
};

/** Structured asset result for the dashboard */
export type AssetResult = {
  readonly chainlinkPrice: number | null;
  readonly signals: AssetSignals;
  readonly windows: Record<string, WindowResult>;
};

/** Structured signal result for the dashboard API endpoint */
export type StructuredSignalResult = Record<string, AssetResult>;

/**
 * Signal correlation metrics for predictive validation
 */
export type SignalCorrelationMetrics = {
  readonly signalId: string;
  readonly correlation: number;
  readonly pValue: number;
  readonly sampleSize: number;
  readonly lastUpdate: number;
  readonly isValid: boolean;
};

/**
 * Historical tracking for signal-outcome pairs
 */
export type SignalOutcomeSample = {
  readonly signalValue: number;
  readonly outcomeValue: number;
  readonly timestamp: number;
};

/**
 * Correlation history buffer per signal
 */
export type SignalCorrelationHistory = {
  readonly signalId: string;
  readonly samples: SignalOutcomeSample[];
  readonly maxSamples: number;
};
