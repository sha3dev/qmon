/**
 * @section imports:internals
 */

import type { AssetResult, HorizonSignalValues, StructuredSignalResult, WindowResult } from "../signal/signal.types.ts";
import type { TriggerEvent, TriggerSeverity } from "./trigger.types.ts";

/**
 * @section consts
 */

/** Threshold for distance signal to qualify as a breakout. */
const BREAKOUT_THRESHOLD = 0.5;

/** Threshold for imbalance signal to qualify as book pressure. */
const BOOK_PRESSURE_THRESHOLD = 0.5;

/** Threshold for acceleration signal to qualify as a spike. */
const ACCELERATION_THRESHOLD = 0.5;

/** Threshold for edge signal to qualify as mispricing. */
const MISPRICING_THRESHOLD = 0.4;

/** Threshold for marketEfficiency signal to qualify as anomaly. */
const EFFICIENCY_THRESHOLD = 0.5;

/** Threshold for bookDepth signal to qualify as liquidity shift. */
const LIQUIDITY_THRESHOLD = 0.5;

/** Threshold for meanReversion horizon to qualify as extreme. */
const REVERSION_THRESHOLD = 0.6;

/** Market progress fraction above which time-decay triggers. */
const TIME_DECAY_PROGRESS = 0.8;

/** Maximum absolute distance for time-decay (uncertain outcome). */
const TIME_DECAY_DISTANCE = 0.15;

/**
 * NEW STATE-BASED TRIGGER THRESHOLDS
 * These triggers fire on sustained strong conditions, not just transitions.
 */

/** Threshold for strong sustained momentum (state-based, not transition-based). */
const STRONG_MOMENTUM_THRESHOLD = 0.35;

/** Threshold for strong order book imbalance (state-based). */
const STRONG_IMBALANCE_THRESHOLD = 0.4;

/** Threshold for extreme price distance from strike (state-based). */
const EXTREME_DISTANCE_THRESHOLD = 0.6;

/** Minimum time between state-based trigger refires (milliseconds). */
const STATE_TRIGGER_COOLDON_MS = 60_000;

/**
 * @section class
 */
export class TriggerEngine {
  /**
   * @section private:attributes
   */

  /**
   * Stores the previous structured result so triggers only fire on
   * meaningful transitions instead of repeating on every evaluation.
   */
  private previousResult: StructuredSignalResult | null;

  /**
   * Tracks last fire time for state-based triggers to prevent spam.
   * Map key format: "triggerId|asset|window" (window is null for asset-level).
   */
  private readonly lastStateTriggerFire: Map<string, number>;

  /**
   * @section constructor
   */

  public constructor() {
    this.previousResult = null;
    this.lastStateTriggerFire = new Map();
  }

  /**
   * @section factory
   */

  public static createDefault(): TriggerEngine {
    return new TriggerEngine();
  }

  /**
   * @section private:methods
   */

  /** Check if a value crossed an absolute threshold from below to above. */
  private hasCrossedAbsoluteThreshold(current: number | null, previous: number | null, threshold: number): boolean {
    const result = typeof current === "number" && typeof previous === "number" && Math.abs(current) > threshold && Math.abs(previous) <= threshold;
    return result;
  }

  /** Check if a value crossed a specific level in either direction. */
  private hasCrossedLevel(current: number | null, previous: number | null, level: number): boolean {
    const result =
      typeof current === "number" && typeof previous === "number" && ((current >= level && previous < level) || (current < level && previous >= level));
    return result;
  }

  /** Compute the net sign balance of multi-horizon signal values. */
  private computeHorizonSignBalance(horizons: HorizonSignalValues): number {
    let sum = 0;
    for (const v of Object.values(horizons)) {
      if (typeof v === "number") {
        sum += Math.sign(v);
      }
    }
    return sum;
  }

  /** Find the maximum absolute value across horizon signals. */
  private computeMaxAbsoluteHorizon(horizons: HorizonSignalValues): number {
    let max = 0;
    for (const v of Object.values(horizons)) {
      if (typeof v === "number" && Math.abs(v) > max) {
        max = Math.abs(v);
      }
    }
    return max;
  }

  /** Compute market progress as a fraction [0, 1] from timing data. */
  private computeProgress(marketStartMs: number | null, marketEndMs: number | null, now: number): number | null {
    const isValid = typeof marketStartMs === "number" && typeof marketEndMs === "number" && marketEndMs > marketStartMs;
    const result = isValid ? Math.max(0, Math.min(1, (now - marketStartMs) / (marketEndMs - marketStartMs))) : null;
    return result;
  }

  /** Build a complete trigger event. */
  private buildEvent(
    id: string,
    label: string,
    description: string,
    severity: TriggerSeverity,
    asset: string,
    window: string | null,
    firedAt: number,
  ): TriggerEvent {
    const result: TriggerEvent = {
      id,
      label,
      description,
      severity,
      asset,
      window,
      firedAt,
    };
    return result;
  }

  /* ── Window-level trigger checks ─────────────────────────────── */

  /** Trigger 1: Up token crosses 0.50, marking a consensus change. */
  private checkConsensusFlip(asset: string, window: string, current: WindowResult, previous: WindowResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedLevel(current.prices.upPrice, previous?.prices.upPrice ?? null, 0.5);
    const isUp = typeof current.prices.upPrice === "number" && current.prices.upPrice >= 0.5;
    const direction = isUp ? "UP" : "DOWN";
    const result = hasCrossed ? this.buildEvent("consensus-flip", "Consensus Flip", `Market flipped to ${direction}`, "warning", asset, window, now) : null;
    return result;
  }

  /** Trigger 3: Distance signal crosses breakout threshold. */
  private checkBreakout(asset: string, window: string, current: WindowResult, previous: WindowResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedAbsoluteThreshold(current.signals.distance, previous?.signals.distance ?? null, BREAKOUT_THRESHOLD);
    const direction = typeof current.signals.distance === "number" && current.signals.distance > 0 ? "above" : "below";
    const result = hasCrossed ? this.buildEvent("breakout", "Breakout", `Price broke ${direction} strike`, "critical", asset, window, now) : null;
    return result;
  }

  /** Trigger 6: Edge signal crosses mispricing threshold. */
  private checkMispricing(asset: string, window: string, current: WindowResult, previous: WindowResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedAbsoluteThreshold(current.signals.edge, previous?.signals.edge ?? null, MISPRICING_THRESHOLD);
    const result = hasCrossed ? this.buildEvent("mispricing", "Mispricing", "Token mispriced vs theoretical value", "critical", asset, window, now) : null;
    return result;
  }

  /** Trigger 7: Market expiring soon with uncertain outcome. */
  private checkTimeDecay(asset: string, window: string, current: WindowResult, now: number): TriggerEvent | null {
    const progress = this.computeProgress(current.prices.marketStartMs, current.prices.marketEndMs, now);
    const isNearEnd = typeof progress === "number" && progress > TIME_DECAY_PROGRESS;
    const isUncertain = typeof current.signals.distance === "number" && Math.abs(current.signals.distance) < TIME_DECAY_DISTANCE;
    const result =
      isNearEnd && isUncertain ? this.buildEvent("time-decay", "Time Decay", "Expiring soon with uncertain outcome", "warning", asset, window, now) : null;
    return result;
  }

  /** Trigger 9: Market efficiency anomaly crosses threshold. */
  private checkEfficiencyAnomaly(asset: string, window: string, current: WindowResult, previous: WindowResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedAbsoluteThreshold(current.signals.marketEfficiency, previous?.signals.marketEfficiency ?? null, EFFICIENCY_THRESHOLD);
    const result = hasCrossed ? this.buildEvent("efficiency-anomaly", "Efficiency", "Market efficiency anomaly detected", "warning", asset, window, now) : null;
    return result;
  }

  /* ── Asset-level trigger checks ──────────────────────────────── */

  /** Trigger 2: Net momentum sign flips across horizons. */
  private checkMomentumShift(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const currentBalance = this.computeHorizonSignBalance(current.signals.momentum);
    const previousBalance = previous ? this.computeHorizonSignBalance(previous.signals.momentum) : 0;
    const hasFlipped = currentBalance !== 0 && previousBalance !== 0 && Math.sign(currentBalance) !== Math.sign(previousBalance);
    const direction = currentBalance > 0 ? "bullish" : "bearish";
    const result = hasFlipped ? this.buildEvent("momentum-shift", "Momentum", `Momentum turned ${direction}`, "warning", asset, null, now) : null;
    return result;
  }

  /** Trigger 4: Imbalance signal crosses threshold. */
  private checkBookPressure(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedAbsoluteThreshold(current.signals.imbalance, previous?.signals.imbalance ?? null, BOOK_PRESSURE_THRESHOLD);
    const direction = typeof current.signals.imbalance === "number" && current.signals.imbalance > 0 ? "buy" : "sell";
    const result = hasCrossed
      ? this.buildEvent("book-pressure", "Book Pressure", `Strong ${direction} pressure in order book`, "warning", asset, null, now)
      : null;
    return result;
  }

  /** Trigger 5: Acceleration signal crosses threshold. */
  private checkAccelerationSpike(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedAbsoluteThreshold(current.signals.acceleration, previous?.signals.acceleration ?? null, ACCELERATION_THRESHOLD);
    const result = hasCrossed ? this.buildEvent("acceleration-spike", "Acceleration", "Price acceleration spike detected", "info", asset, null, now) : null;
    return result;
  }

  /** Trigger 8: Max absolute meanReversion horizon crosses extreme. */
  private checkReversionExtreme(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const currentMax = this.computeMaxAbsoluteHorizon(current.signals.meanReversion);
    const previousMax = previous ? this.computeMaxAbsoluteHorizon(previous.signals.meanReversion) : 0;
    const hasCrossed = currentMax > REVERSION_THRESHOLD && previousMax <= REVERSION_THRESHOLD;
    const result = hasCrossed ? this.buildEvent("reversion-extreme", "Reversion", "Mean reversion at extreme level", "info", asset, null, now) : null;
    return result;
  }

  /** Trigger 10: Book depth signal crosses threshold. */
  private checkLiquidityShift(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const hasCrossed = this.hasCrossedAbsoluteThreshold(current.signals.bookDepth, previous?.signals.bookDepth ?? null, LIQUIDITY_THRESHOLD);
    const result = hasCrossed ? this.buildEvent("liquidity-shift", "Liquidity", "Significant liquidity change detected", "info", asset, null, now) : null;
    return result;
  }

  /* ── State-based trigger checks (NEW - not transition-based) ───── */

  /**
   * Check if a state-based trigger can fire based on cooldown.
   * State triggers can fire repeatedly while condition holds, but with a minimum interval.
   */
  private canFireStateTrigger(triggerId: string, asset: string, window: string | null, now: number): boolean {
    const key = `${triggerId}|${asset}|${window ?? ""}`;
    const lastFire = this.lastStateTriggerFire.get(key) ?? 0;
    const canFire = now - lastFire >= STATE_TRIGGER_COOLDON_MS;
    return canFire;
  }

  /**
   * Mark a state-based trigger as fired.
   */
  private markStateTriggerFired(triggerId: string, asset: string, window: string | null, now: number): void {
    const key = `${triggerId}|${asset}|${window ?? ""}`;
    this.lastStateTriggerFire.set(key, now);
  }

  /**
   * Trigger 11 (NEW): Strong sustained momentum (state-based).
   * Fires when momentum signal is strongly positive or negative, regardless of transition.
   */
  private checkStrongMomentum(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const maxMomentum = this.computeMaxAbsoluteHorizon(current.signals.momentum);
    const previousMaxMomentum = previous !== null ? this.computeMaxAbsoluteHorizon(previous.signals.momentum) : 0;
    const canFire = this.canFireStateTrigger("strong-momentum", asset, null, now);
    let stateTrigger: TriggerEvent | null = null;

    if (maxMomentum >= STRONG_MOMENTUM_THRESHOLD) {
      if (canFire && previousMaxMomentum >= STRONG_MOMENTUM_THRESHOLD) {
        const direction = current.signals.momentum["30s"] ?? current.signals.momentum["2m"] ?? current.signals.momentum["5m"] ?? 0;
        const directionLabel = direction > 0 ? "bullish" : "bearish";

        stateTrigger = this.buildEvent("strong-momentum", "Strong Momentum", `Strong ${directionLabel} momentum detected`, "warning", asset, null, now);
      }

      this.markStateTriggerFired("strong-momentum", asset, null, now);
    }

    return stateTrigger;
  }

  /**
   * Trigger 12 (NEW): Strong order book imbalance (state-based).
   * Fires when order book is significantly skewed to one side.
   */
  private checkStrongImbalance(asset: string, current: AssetResult, previous: AssetResult | null, now: number): TriggerEvent | null {
    const imbalance = current.signals.imbalance;
    const previousImbalance = previous?.signals.imbalance ?? null;
    const canFire = this.canFireStateTrigger("strong-imbalance", asset, null, now);
    let stateTrigger: TriggerEvent | null = null;

    if (imbalance !== null && Math.abs(imbalance) >= STRONG_IMBALANCE_THRESHOLD) {
      if (canFire && previousImbalance !== null && Math.abs(previousImbalance) >= STRONG_IMBALANCE_THRESHOLD) {
        const direction = imbalance > 0 ? "buy" : "sell";

        stateTrigger = this.buildEvent("strong-imbalance", "Strong Imbalance", `Strong ${direction} pressure in order book`, "warning", asset, null, now);
      }

      this.markStateTriggerFired("strong-imbalance", asset, null, now);
    }

    return stateTrigger;
  }

  /**
   * Trigger 13 (NEW): Extreme price distance from strike (state-based).
   * Fires when price is far from strike, indicating clear directional bias.
   */
  private checkExtremeDistance(asset: string, window: string, current: WindowResult, previous: WindowResult | null, now: number): TriggerEvent | null {
    const distance = current.signals.distance;
    const previousDistance = previous?.signals.distance ?? null;
    const canFire = this.canFireStateTrigger("extreme-distance", asset, window, now);
    let stateTrigger: TriggerEvent | null = null;

    if (distance !== null && Math.abs(distance) >= EXTREME_DISTANCE_THRESHOLD) {
      if (canFire && previousDistance !== null && Math.abs(previousDistance) >= EXTREME_DISTANCE_THRESHOLD) {
        const direction = distance > 0 ? "above" : "below";

        stateTrigger = this.buildEvent("extreme-distance", "Extreme Distance", `Price strongly ${direction} strike`, "critical", asset, window, now);
      }

      this.markStateTriggerFired("extreme-distance", asset, window, now);
    }

    return stateTrigger;
  }

  /* ── Collectors ───────────────────────────────────────────────── */

  /** Collect all asset-level triggers into the output array. */
  private collectAssetTriggers(triggers: TriggerEvent[], asset: string, current: AssetResult, previous: AssetResult | null, now: number): void {
    // Original transition-based triggers
    const transitionChecks = [
      this.checkMomentumShift(asset, current, previous, now),
      this.checkBookPressure(asset, current, previous, now),
      this.checkAccelerationSpike(asset, current, previous, now),
      this.checkReversionExtreme(asset, current, previous, now),
      this.checkLiquidityShift(asset, current, previous, now),
    ];
    // NEW state-based triggers (fire on strong conditions, not just transitions)
    const stateChecks = [
      this.checkStrongMomentum(asset, current, previous, now),
      this.checkStrongImbalance(asset, current, previous, now),
    ];

    for (const trigger of [...transitionChecks, ...stateChecks]) {
      if (trigger !== null) {
        triggers.push(trigger);
      }
    }
  }

  /** Collect all window-level triggers into the output array. */
  private collectWindowTriggers(
    triggers: TriggerEvent[],
    asset: string,
    window: string,
    current: WindowResult,
    previous: WindowResult | null,
    now: number,
  ): void {
    // Original transition-based triggers
    const transitionChecks = [
      this.checkConsensusFlip(asset, window, current, previous, now),
      this.checkBreakout(asset, window, current, previous, now),
      this.checkMispricing(asset, window, current, previous, now),
      this.checkTimeDecay(asset, window, current, now),
      this.checkEfficiencyAnomaly(asset, window, current, previous, now),
    ];
    // NEW state-based trigger
    const stateChecks = [
      this.checkExtremeDistance(asset, window, current, previous, now),
    ];

    for (const trigger of [...transitionChecks, ...stateChecks]) {
      if (trigger !== null) {
        triggers.push(trigger);
      }
    }
  }

  /**
   * @section public:methods
   */

  /**
   * Evaluate the current structured signal result and return newly fired
   * triggers. Triggers fire on transitions (threshold crossings) relative
   * to the previous evaluation. The first call returns no triggers since
   * there is no prior state to compare against.
   */
  public evaluate(current: StructuredSignalResult): readonly TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const now = Date.now();
    const prev = this.previousResult;

    for (const [asset, currentAsset] of Object.entries(current)) {
      const previousAsset = prev?.[asset] ?? null;
      this.collectAssetTriggers(triggers, asset, currentAsset, previousAsset, now);

      for (const [window, currentWin] of Object.entries(currentAsset.windows)) {
        const previousWin = previousAsset?.windows?.[window] ?? null;
        this.collectWindowTriggers(triggers, asset, window, currentWin, previousWin, now);
      }
    }

    this.previousResult = current;
    return triggers;
  }
}
