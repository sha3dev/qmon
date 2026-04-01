/**
 * @section imports:internals
 */

import type { AssetResult, AssetSignals, HorizonSignalValues } from "../signal/signal.types.ts";
import type { DirectionRegime, RegimeEvent, RegimeResult, RegimeState, VolatilityRegime } from "./regime.types.ts";

/**
 * @section consts
 */

/** Momentum threshold above which trend is considered up. */
const DIRECTION_UP_THRESHOLD = 0.3;

/** Momentum threshold below which trend is considered down. */
const DIRECTION_DOWN_THRESHOLD = -0.3;

/** Volatility ratio threshold for high regime. */
const VOLATILITY_HIGH_THRESHOLD = 0.4;

/** Volatility ratio threshold for low regime. */
const VOLATILITY_LOW_THRESHOLD = -0.4;

/** Horizon weights for momentum averaging (shorter = more weight). */
const HORIZON_WEIGHTS: Record<string, number> = {
  "30s": 1.0,
  "2m": 0.7,
  "5m": 0.4,
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

  /**
   * @section constructor
   */

  public constructor() {
    this.previousStates = {};
  }

  /**
   * @section factory
   */

  public static createDefault(): RegimeEngine {
    return new RegimeEngine();
  }

  /**
   * @section private:methods
   */

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
   * Classify direction regime based on momentum signal.
   */
  private classifyDirection(momentum: HorizonSignalValues): { regime: DirectionRegime; strength: number } {
    const avgMomentum = this.computeHorizonAverage(momentum);

    if (avgMomentum === null) {
      return { regime: "flat", strength: 0 };
    }

    // Strength is the distance from the nearest threshold, normalized to [0, 1]
    if (avgMomentum >= DIRECTION_UP_THRESHOLD) {
      const strength = Math.min(1, (avgMomentum - DIRECTION_UP_THRESHOLD) / (1 - DIRECTION_UP_THRESHOLD) + 0.5);
      return { regime: "trending-up", strength };
    }
    if (avgMomentum <= DIRECTION_DOWN_THRESHOLD) {
      const strength = Math.min(1, (DIRECTION_DOWN_THRESHOLD - avgMomentum) / (1 + DIRECTION_DOWN_THRESHOLD) + 0.5);
      return { regime: "trending-down", strength };
    }

    // Flat regime - strength is higher when closer to zero
    const strength = 1 - Math.abs(avgMomentum) / Math.max(Math.abs(DIRECTION_UP_THRESHOLD), Math.abs(DIRECTION_DOWN_THRESHOLD));
    return { regime: "flat", strength: Math.max(0, strength) };
  }

  /**
   * Classify volatility regime based on volatility regime signal.
   */
  private classifyVolatility(volRegime: number | null): { regime: VolatilityRegime; level: number } {
    if (volRegime === null) {
      return { regime: "normal", level: 0.5 };
    }

    // Map [-1, 1] to [0, 1] for level
    const level = (volRegime + 1) / 2;

    if (volRegime >= VOLATILITY_HIGH_THRESHOLD) {
      return { regime: "high", level };
    }
    if (volRegime <= VOLATILITY_LOW_THRESHOLD) {
      return { regime: "low", level };
    }

    return { regime: "normal", level };
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

      // Classify direction regime from momentum
      const { regime: direction, strength: directionStrength } = this.classifyDirection(signals.momentum);

      // Classify volatility regime from volatilityRegime signal
      const { regime: volatility, level: volatilityLevel } = this.classifyVolatility(signals.volatilityRegime);

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
