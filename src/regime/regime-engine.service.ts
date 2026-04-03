/**
 * @section imports:internals
 */

import type { AssetResult, AssetSignals, HorizonSignalValues } from "../signal/signal.types.ts";
import type { DirectionRegime, RegimeEvent, RegimeResult, RegimeState, VolatilityRegime } from "./regime.types.ts";

/**
 * @section consts
 */

/** Default percentile thresholds for regime classification. */
const DIRECTION_UP_PERCENTILE = 0.7;
const DIRECTION_DOWN_PERCENTILE = 0.3;
const VOLATILITY_HIGH_PERCENTILE = 0.7;
const VOLATILITY_LOW_PERCENTILE = 0.3;

/** Minimum history size for percentile calculation. */
const MIN_HISTORY_SIZE = 20;
const DEFAULT_MAX_HISTORY_SIZE = 100;

/** Horizon weights for momentum averaging (shorter = more weight). */
const HORIZON_WEIGHTS: Record<string, number> = {
  "30s": 1.0,
  "2m": 0.7,
  "5m": 0.4,
};

type SignalHistory = {
  readonly values: number[];
  readonly maxSize: number;
};

/**
 * @section class
 */
export class RegimeEngine {
  /**
   * @section private:attributes
   */

  /** Previous regime states for change detection. */
  private previousStates: RegimeResult;

  /** Historical signal values for percentile calculation. */
  private momentumHistory: Map<string, SignalHistory>;
  private volatilityHistory: Map<string, SignalHistory>;
  private readonly maxHistorySize: number;

  /**
   * @section constructor
   */

  public constructor(maxHistorySize = DEFAULT_MAX_HISTORY_SIZE) {
    this.previousStates = {};
    this.momentumHistory = new Map();
    this.volatilityHistory = new Map();
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * @section factory
   */

  public static createDefault(): RegimeEngine {
    return new RegimeEngine(DEFAULT_MAX_HISTORY_SIZE);
  }

  /**
   * @section private:methods
   */

  /**
   * Update history buffer with new value.
   */
  private updateHistory(history: Map<string, SignalHistory>, key: string, value: number): void {
    let signalHistory = history.get(key);

    if (signalHistory === undefined) {
      signalHistory = { values: [], maxSize: this.maxHistorySize };
      history.set(key, signalHistory);
    }

    // Add new value
    signalHistory.values.push(value);

    // Trim to max size
    if (signalHistory.values.length > signalHistory.maxSize) {
      signalHistory.values.shift();
    }
  }

  /**
   * Calculate percentile of value within history.
   */
  private calculatePercentile(value: number, history: SignalHistory | null): number {
    if (history === null || history.values.length < MIN_HISTORY_SIZE) {
      return 0.5; // Default to neutral if insufficient history
    }

    const rank = history.values.filter((v) => v <= value).length;
    return (rank - 1) / (history.values.length - 1);
  }

  /**
   * Compute weighted average of horizon signal values.
   * Returns null if no valid horizon values exist.
   */
  private computeHorizonAverage(horizons: HorizonSignalValues): number | null {
    let sumWeighted = 0;
    let sumWeights = 0;

    for (const [horizon, value] of Object.entries(horizons)) {
      if (typeof value === "number" && HORIZON_WEIGHTS[horizon] !== undefined) {
        const weight = HORIZON_WEIGHTS[horizon];
        sumWeighted += value * weight;
        sumWeights += weight;
      }
    }

    return sumWeights > 0 ? sumWeighted / sumWeights : null;
  }

  /**
   * Classify direction regime based on momentum percentile.
   * Uses adaptive percentile thresholds instead of fixed values.
   */
  private classifyDirection(asset: string, momentum: HorizonSignalValues): { regime: DirectionRegime; strength: number } {
    const avgMomentum = this.computeHorizonAverage(momentum);

    if (avgMomentum === null) {
      return { regime: "flat", strength: 0 };
    }

    // Update history and get percentile
    this.updateHistory(this.momentumHistory, asset, avgMomentum);
    const history = this.momentumHistory.get(asset) ?? null;
    const percentile = this.calculatePercentile(avgMomentum, history);

    // Classify using percentiles
    if (percentile >= DIRECTION_UP_PERCENTILE) {
      const strength = (percentile - DIRECTION_UP_PERCENTILE) / (1 - DIRECTION_UP_PERCENTILE);
      return { regime: "trending-up", strength: Math.min(1, strength + 0.5) };
    }
    if (percentile <= DIRECTION_DOWN_PERCENTILE) {
      const strength = (DIRECTION_DOWN_PERCENTILE - percentile) / DIRECTION_DOWN_PERCENTILE;
      return { regime: "trending-down", strength: Math.min(1, strength + 0.5) };
    }

    // Flat regime - strength based on distance from nearest threshold
    const distanceFromNeutral = Math.abs(percentile - 0.5) * 2;
    const strength = 1 - distanceFromNeutral;
    return { regime: "flat", strength: Math.max(0, strength) };
  }

  /**
   * Classify volatility regime based on volatility percentile.
   * Uses adaptive percentile thresholds instead of fixed values.
   */
  private classifyVolatility(asset: string, volRegime: number | null): { regime: VolatilityRegime; level: number } {
    if (volRegime === null) {
      return { regime: "normal", level: 0.5 };
    }

    // Map [-1, 1] to [0, 1] for level calculation
    const normalizedVol = (volRegime + 1) / 2;

    // Update history and get percentile
    this.updateHistory(this.volatilityHistory, asset, normalizedVol);
    const history = this.volatilityHistory.get(asset) ?? null;
    const percentile = this.calculatePercentile(normalizedVol, history);

    // Classify using percentiles
    if (percentile >= VOLATILITY_HIGH_PERCENTILE) {
      return { regime: "high", level: percentile };
    }
    if (percentile <= VOLATILITY_LOW_PERCENTILE) {
      return { regime: "low", level: percentile };
    }

    return { regime: "normal", level: percentile };
  }

  /**
   * Create a regime change event.
   */
  private buildEvent(
    id: string,
    label: string,
    description: string,
    asset: string,
    regimeType: "direction" | "volatility",
    previous: DirectionRegime | VolatilityRegime,
    current: DirectionRegime | VolatilityRegime,
    firedAt: number,
  ): RegimeEvent {
    const severity: "info" | "warning" = regimeType === "direction" ? "warning" : "info";

    return {
      id,
      label,
      description,
      severity,
      asset,
      regimeType,
      previous,
      current,
      firedAt,
    };
  }

  /**
   * Format regime label for display.
   */
  private formatRegimeLabel(regime: DirectionRegime | VolatilityRegime): string {
    switch (regime) {
      case "trending-up":
        return "TREND UP";
      case "trending-down":
        return "TREND DOWN";
      case "flat":
        return "FLAT";
      case "high":
        return "VOL HIGH";
      case "normal":
        return "VOL NORM";
      case "low":
        return "VOL LOW";
    }
  }

  /**
   * @section public:methods
   */

  /**
   * Evaluate the current structured signal result and return regime states
   * plus any newly fired regime change events.
   */
  public evaluate(current: Record<string, AssetResult>): { states: RegimeResult; events: readonly RegimeEvent[] } {
    const states: RegimeResult = {};
    const events: RegimeEvent[] = [];
    const now = Date.now();

    for (const [asset, assetResult] of Object.entries(current)) {
      const signals: AssetSignals = assetResult.signals;

      // Classify direction regime from momentum using percentiles
      const { regime: direction, strength: directionStrength } = this.classifyDirection(asset, signals.momentum);

      // Classify volatility regime from volatilityRegime signal using percentiles
      const { regime: volatility, level: volatilityLevel } = this.classifyVolatility(asset, signals.volatilityRegime);

      const state: RegimeState = {
        direction,
        volatility,
        directionStrength,
        volatilityLevel,
        lastUpdated: now,
      };

      states[asset] = state;

      // Check for direction regime change
      const previousState = this.previousStates[asset];
      if (previousState && previousState.direction !== direction) {
        const event = this.buildEvent(
          `regime-direction-${asset}`,
          "Direction Change",
          `${asset.toUpperCase()} regime changed from ${this.formatRegimeLabel(previousState.direction)} to ${this.formatRegimeLabel(direction)}`,
          asset,
          "direction",
          previousState.direction,
          direction,
          now,
        );
        events.push(event);
      }

      // Check for volatility regime change
      if (previousState && previousState.volatility !== volatility) {
        const event = this.buildEvent(
          `regime-volatility-${asset}`,
          "Volatility Change",
          `${asset.toUpperCase()} volatility changed from ${this.formatRegimeLabel(previousState.volatility)} to ${this.formatRegimeLabel(volatility)}`,
          asset,
          "volatility",
          previousState.volatility,
          volatility,
          now,
        );
        events.push(event);
      }
    }

    this.previousStates = states;
    return { states, events };
  }

  /**
   * Get the current regime state for all assets without processing new data.
   */
  public getCurrentStates(): RegimeResult {
    return this.previousStates;
  }
}
