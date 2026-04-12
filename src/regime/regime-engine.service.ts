/**
 * @section imports:internals
 */

import type { AssetResult } from "../signal/signal.types.ts";
import type { DirectionRegime, RegimeEvent, RegimeResult, RegimeState } from "./regime.types.ts";

/**
 * @section class
 */

export class RegimeEngine {
  /**
   * @section private:attributes
   */

  private currentStates: RegimeResult;

  /**
   * @section constructor
   */

  public constructor() {
    this.currentStates = {};
  }

  /**
   * @section factory
   */

  public static createDefault(): RegimeEngine {
    const regimeEngine = new RegimeEngine();

    return regimeEngine;
  }

  /**
   * @section private:methods
   */

  private classifyDirection(assetResult: AssetResult): DirectionRegime {
    const latestMomentum = assetResult.signals.momentum["30s"] ?? assetResult.signals.momentum["2m"] ?? assetResult.signals.momentum["5m"] ?? 0;
    let direction: DirectionRegime = "flat";

    if (latestMomentum > 0.02) {
      direction = "trending-up";
    } else {
      if (latestMomentum < -0.02) {
        direction = "trending-down";
      }
    }

    return direction;
  }

  private buildState(assetResult: AssetResult): RegimeState {
    const direction = this.classifyDirection(assetResult);
    const state: RegimeState = {
      direction,
      volatility: "normal",
      directionStrength: direction === "flat" ? 0 : 1,
      volatilityLevel: 0.5,
      lastUpdated: Date.now(),
    };

    return state;
  }

  private maybeBuildDirectionEvent(asset: string, previousState: RegimeState | undefined, nextState: RegimeState): RegimeEvent | null {
    let regimeEvent: RegimeEvent | null = null;

    if (previousState !== undefined && previousState.direction !== nextState.direction) {
      regimeEvent = {
        id: `${asset}-${nextState.lastUpdated}`,
        label: `Trend changed to ${nextState.direction}`,
        description: `The simplified regime engine detected a direction change for ${asset}.`,
        severity: "warning",
        asset,
        regimeType: "direction",
        previous: previousState.direction,
        current: nextState.direction,
        firedAt: nextState.lastUpdated,
      };
    }

    return regimeEvent;
  }

  /**
   * @section public:methods
   */

  public evaluate(current: Record<string, AssetResult>): { states: RegimeResult; events: readonly RegimeEvent[] } {
    const nextStates: RegimeResult = {};
    const regimeEvents: RegimeEvent[] = [];

    for (const [asset, assetResult] of Object.entries(current)) {
      const nextState = this.buildState(assetResult);
      const previousState = this.currentStates[asset];
      const regimeEvent = this.maybeBuildDirectionEvent(asset, previousState, nextState);

      nextStates[asset] = nextState;

      if (regimeEvent !== null) {
        regimeEvents.push(regimeEvent);
      }
    }

    this.currentStates = nextStates;

    return {
      states: nextStates,
      events: regimeEvents,
    };
  }

  public getCurrentStates(): RegimeResult {
    const currentStates = this.currentStates;

    return currentStates;
  }
}
