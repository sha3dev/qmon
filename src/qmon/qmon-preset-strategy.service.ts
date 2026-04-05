/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  DirectionRegimeGenes,
  DirectionRegimeValue,
  DominantSignalGroup,
  EntryPolicy,
  ExecutionPolicy,
  ExitPolicy,
  MicrostructureSignalGene,
  PredictiveSignalGene,
  QmonGenome,
  QmonPresetSignalEvaluation,
  QmonPresetStrategyDefinition,
  SignalGene,
  SignalWeights,
  ThesisInvalidationPolicy,
  TimeSegment,
  TimeWindowGenes,
  TriggerGene,
  VolatilityRegimeGenes,
  VolatilityRegimeValue,
} from "./qmon.types.ts";

/**
 * @section consts
 */

const PRESET_VARIANTS_PER_FAMILY = 20;
const PRESET_SIGNAL_AGREEMENT_FLOOR = 3;
const PRESET_FAMILY_IDS = [
  "late-threshold-sprint",
  "early-breakout-ramp",
  "sma-crossover-follow",
  "spread-compression-burst",
  "spread-shock-fade",
  "microprice-pressure-follow",
  "imbalance-flip-chase",
  "book-depth-wall-ride",
  "liquidity-vacuum-snapback",
  "stale-oracle-catchup",
  "momentum-lookback-pulse",
  "edge-distance-confluence",
  "bollinger-zscore-reversion",
  "time-decay-consensus-drift",
  "high-price-continuation",
  "low-price-capitulation-rebound",
  "late-consensus-lock-in",
  "volatility-expansion-break",
  "calm-range-drift",
  "token-pressure-reversal",
] as const;

const PRESET_TRIGGER_IDS_BY_FAMILY: Record<PresetFamilyId, readonly string[]> = {
  "late-threshold-sprint": ["extreme-distance", "strong-momentum"],
  "early-breakout-ramp": ["breakout", "acceleration-spike"],
  "sma-crossover-follow": ["momentum-shift", "consensus-flip"],
  "spread-compression-burst": ["breakout", "book-pressure"],
  "spread-shock-fade": ["liquidity-shift", "reversion-extreme"],
  "microprice-pressure-follow": ["book-pressure", "consensus-flip"],
  "imbalance-flip-chase": ["strong-imbalance", "momentum-shift"],
  "book-depth-wall-ride": ["book-pressure", "consensus-flip"],
  "liquidity-vacuum-snapback": ["liquidity-shift", "mispricing"],
  "stale-oracle-catchup": ["efficiency-anomaly", "time-decay"],
  "momentum-lookback-pulse": ["strong-momentum", "consensus-flip"],
  "edge-distance-confluence": ["mispricing", "consensus-flip"],
  "bollinger-zscore-reversion": ["reversion-extreme", "mispricing"],
  "time-decay-consensus-drift": ["time-decay", "consensus-flip"],
  "high-price-continuation": ["strong-momentum", "breakout"],
  "low-price-capitulation-rebound": ["reversion-extreme", "extreme-distance"],
  "late-consensus-lock-in": ["consensus-flip", "strong-momentum"],
  "volatility-expansion-break": ["acceleration-spike", "breakout"],
  "calm-range-drift": ["time-decay", "mispricing"],
  "token-pressure-reversal": ["strong-imbalance", "reversion-extreme"],
} as const;

const PRESET_FAMILY_LABELS: Record<PresetFamilyId, string> = {
  "late-threshold-sprint": "Late Threshold Sprint",
  "early-breakout-ramp": "Early Breakout Ramp",
  "sma-crossover-follow": "SMA Crossover Follow",
  "spread-compression-burst": "Spread Compression Burst",
  "spread-shock-fade": "Spread Shock Fade",
  "microprice-pressure-follow": "Microprice Pressure Follow",
  "imbalance-flip-chase": "Imbalance Flip Chase",
  "book-depth-wall-ride": "Book Depth Wall Ride",
  "liquidity-vacuum-snapback": "Liquidity Vacuum Snapback",
  "stale-oracle-catchup": "Stale Oracle Catchup",
  "momentum-lookback-pulse": "Momentum Lookback Pulse",
  "edge-distance-confluence": "Edge Distance Confluence",
  "bollinger-zscore-reversion": "Bollinger ZScore Reversion",
  "time-decay-consensus-drift": "Time Decay Consensus Drift",
  "high-price-continuation": "High Price Continuation",
  "low-price-capitulation-rebound": "Low Price Capitulation Rebound",
  "late-consensus-lock-in": "Late Consensus Lock In",
  "volatility-expansion-break": "Volatility Expansion Break",
  "calm-range-drift": "Calm Range Drift",
  "token-pressure-reversal": "Token Pressure Reversal",
} as const;

/**
 * @section types
 */

type PresetFamilyId = (typeof PRESET_FAMILY_IDS)[number];

type PresetSignalContext = {
  readonly upPrice: number;
  readonly downPrice: number;
  readonly edge: number;
  readonly distance: number;
  readonly momentum: number;
  readonly velocity: number;
  readonly meanReversion: number;
  readonly crossAssetMomentum: number;
  readonly imbalance: number;
  readonly microprice: number;
  readonly bookDepth: number;
  readonly spread: number;
  readonly staleness: number;
  readonly tokenPressure: number;
};

/**
 * @section class
 */

export class QmonPresetStrategyService {
  /**
   * @section private:attributes
   */

  private readonly presetStrategiesById: ReadonlyMap<string, QmonPresetStrategyDefinition>;
  private readonly orderedPresetStrategies: readonly QmonPresetStrategyDefinition[];

  /**
   * @section constructor
   */

  public constructor() {
    this.orderedPresetStrategies = this.createPresetStrategyCatalog();
    this.presetStrategiesById = new Map(
      this.orderedPresetStrategies.map((presetStrategyDefinition) => [presetStrategyDefinition.presetStrategyId, presetStrategyDefinition]),
    );
  }

  /**
   * @section factory
   */

  public static createDefault(): QmonPresetStrategyService {
    const presetStrategyService = new QmonPresetStrategyService();

    return presetStrategyService;
  }

  /**
   * @section private:methods
   */

  private createPresetStrategyCatalog(): readonly QmonPresetStrategyDefinition[] {
    const presetStrategies: QmonPresetStrategyDefinition[] = [];

    for (const presetFamily of PRESET_FAMILY_IDS) {
      for (let variantIndex = 0; variantIndex < PRESET_VARIANTS_PER_FAMILY; variantIndex += 1) {
        presetStrategies.push(this.createPresetStrategyDefinition(presetFamily, variantIndex));
      }
    }

    return presetStrategies;
  }

  private getPresetFamilyVariantOrder(): readonly QmonPresetStrategyDefinition[] {
    const orderedPresetStrategies: QmonPresetStrategyDefinition[] = [];

    for (let variantIndex = 0; variantIndex < PRESET_VARIANTS_PER_FAMILY; variantIndex += 1) {
      for (const presetFamily of PRESET_FAMILY_IDS) {
        const presetStrategyId = `${presetFamily}-${String(variantIndex + 1).padStart(2, "0")}`;
        const presetStrategyDefinition = this.presetStrategiesById.get(presetStrategyId);

        if (presetStrategyDefinition !== undefined) {
          orderedPresetStrategies.push(presetStrategyDefinition);
        }
      }
    }

    return orderedPresetStrategies;
  }

  private createPresetStrategyDefinition(presetFamily: PresetFamilyId, variantIndex: number): QmonPresetStrategyDefinition {
    const variantStep = variantIndex % 5;
    const triggerIds = this.createPresetTriggerIds(presetFamily, variantIndex);
    const entryPolicy = this.createPresetEntryPolicy(presetFamily, variantIndex);
    const executionPolicy = this.createPresetExecutionPolicy(presetFamily, variantIndex);
    const exitPolicy = this.createPresetExitPolicy(presetFamily, variantIndex);
    const presetStrategyDefinition: QmonPresetStrategyDefinition = {
      presetStrategyId: `${presetFamily}-${String(variantIndex + 1).padStart(2, "0")}`,
      presetFamily,
      strategyName: `${PRESET_FAMILY_LABELS[presetFamily]} ${String(variantIndex + 1).padStart(2, "0")}`,
      strategyDescription: this.createPresetDescription(presetFamily, variantIndex, triggerIds),
      triggerIds,
      timeWindowGenes: this.createPresetTimeWindowGenes(presetFamily, variantIndex),
      directionRegimeGenes: this.createPresetDirectionRegimeGenes(presetFamily, variantIndex),
      volatilityRegimeGenes: this.createPresetVolatilityRegimeGenes(presetFamily, variantIndex),
      entryPolicy,
      executionPolicy,
      exitPolicy,
      minScoreBuy: Number((0.48 + variantStep * 0.03 + (variantIndex >= 10 ? 0.04 : 0)).toFixed(2)),
      minScoreSell: Number((0.48 + ((variantIndex + 2) % 5) * 0.03 + (variantIndex >= 10 ? 0.04 : 0)).toFixed(2)),
      minSignalCount: PRESET_SIGNAL_AGREEMENT_FLOOR + (variantIndex % 2),
      anchorPrice: Number((0.78 + variantStep * 0.03 + (variantIndex >= 10 ? 0.02 : 0)).toFixed(2)),
      slopeThreshold: Number((0.12 + variantStep * 0.02).toFixed(2)),
      edgeThreshold: Number((0.12 + ((variantIndex + 1) % 5) * 0.03).toFixed(2)),
      distanceThreshold: Number((0.1 + ((variantIndex + 3) % 5) * 0.04).toFixed(2)),
      spreadLimit: Number((0.18 + (4 - variantStep) * 0.03).toFixed(2)),
      depthThreshold: Number((0.08 + variantStep * 0.04).toFixed(2)),
      imbalanceThreshold: Number((0.16 + ((variantIndex + 2) % 5) * 0.05).toFixed(2)),
      stalenessLimit: Number((0.08 + (variantStep % 3) * 0.04).toFixed(2)),
      pressureThreshold: Number((0.14 + ((variantIndex + 4) % 5) * 0.04).toFixed(2)),
      alphaScale: Number((0.85 + variantStep * 0.08).toFixed(2)),
    };

    return presetStrategyDefinition;
  }

  private createPresetDescription(presetFamily: PresetFamilyId, variantIndex: number, triggerIds: readonly string[]): string {
    const familyLabel = PRESET_FAMILY_LABELS[presetFamily];
    const triggerLabel = triggerIds.join(" + ");
    const variantIntensity = variantIndex < 7 ? "defensive" : variantIndex < 14 ? "balanced" : "aggressive";
    const presetDescription = `${familyLabel} preset ${variantIndex + 1}: ${variantIntensity} fixed-rule strategy gated by ${triggerLabel}, tuned for ${
      this.getPresetFamilyNarrative(presetFamily)
    }.`;

    return presetDescription;
  }

  private getPresetFamilyNarrative(presetFamily: PresetFamilyId): string {
    const familyNarrative =
      presetFamily === "late-threshold-sprint"
        ? "late-window 0.8-0.95 continuation after one token starts trending to resolution"
        : presetFamily === "early-breakout-ramp"
          ? "early-window breakout acceleration before the order book thickens"
          : presetFamily === "sma-crossover-follow"
            ? "short-vs-long SMA proxy crossovers with trend confirmation"
            : presetFamily === "spread-compression-burst"
              ? "tight-spread breakouts confirmed by book pressure"
              : presetFamily === "spread-shock-fade"
                ? "wide-spread shock fading once distance and mean reversion turn"
                : presetFamily === "microprice-pressure-follow"
                  ? "microprice and imbalance alignment with enough depth behind the move"
                  : presetFamily === "imbalance-flip-chase"
                    ? "order-flow flips that start dominating short-horizon momentum"
                    : presetFamily === "book-depth-wall-ride"
                      ? "depth support on one side of the book with matching directional drift"
                      : presetFamily === "liquidity-vacuum-snapback"
                        ? "vacuum reversion when depth disappears and distance is stretched"
                        : presetFamily === "stale-oracle-catchup"
                          ? "catch-up moves when staleness resolves and cross-asset drift agrees"
                          : presetFamily === "momentum-lookback-pulse"
                            ? "fast-vs-slow momentum lookback continuation with local velocity confirmation"
                            : presetFamily === "edge-distance-confluence"
                              ? "aligned edge and distance with low spread tax"
                              : presetFamily === "bollinger-zscore-reversion"
                                ? "Bollinger-style band stretch and z-score snapback"
                                : presetFamily === "time-decay-consensus-drift"
                                  ? "late consensus drift where time decay and pressure agree"
                                  : presetFamily === "high-price-continuation"
                                    ? "high-token-price continuation into a likely binary lock"
                                    : presetFamily === "low-price-capitulation-rebound"
                                      ? "low-price capitulation reversals when distance gets extreme"
                                      : presetFamily === "late-consensus-lock-in"
                                        ? "late consensus confirmation when one side is already dominating"
                                        : presetFamily === "volatility-expansion-break"
                                          ? "volatility expansion with acceleration and directional confirmation"
                                          : presetFamily === "calm-range-drift"
                                            ? "low-volatility drift where spread stays cheap and pressure is steady"
                                            : "token-pressure reversal once pressure, distance and book depth disagree";

    return familyNarrative;
  }

  private createPresetTriggerIds(presetFamily: PresetFamilyId, variantIndex: number): readonly string[] {
    const triggerPool = PRESET_TRIGGER_IDS_BY_FAMILY[presetFamily];
    const rotatedTriggerIds =
      variantIndex % 4 === 0
        ? [triggerPool[0] ?? "consensus-flip"]
        : variantIndex % 4 === 1
          ? [triggerPool[1] ?? "momentum-shift"]
          : [triggerPool[0] ?? "consensus-flip", triggerPool[1] ?? "momentum-shift"];

    return rotatedTriggerIds;
  }

  private createPresetTimeWindowGenes(presetFamily: PresetFamilyId, variantIndex: number): TimeWindowGenes {
    let timeWindowGenes: TimeWindowGenes = [true, true, true];

    if (presetFamily.startsWith("late-") || presetFamily === "high-price-continuation" || presetFamily === "time-decay-consensus-drift") {
      timeWindowGenes = variantIndex % 3 === 0 ? [false, true, true] : [false, false, true];
    } else if (presetFamily === "early-breakout-ramp" || presetFamily === "volatility-expansion-break") {
      timeWindowGenes = variantIndex % 3 === 0 ? [true, true, false] : [true, false, false];
    } else if (presetFamily === "sma-crossover-follow" || presetFamily === "calm-range-drift") {
      timeWindowGenes = [false, true, false];
    }

    return timeWindowGenes;
  }

  private createPresetDirectionRegimeGenes(presetFamily: PresetFamilyId, variantIndex: number): DirectionRegimeGenes {
    let directionRegimeGenes: DirectionRegimeGenes = [true, true, true];

    if (
      presetFamily === "early-breakout-ramp" ||
      presetFamily === "momentum-lookback-pulse" ||
      presetFamily === "high-price-continuation" ||
      presetFamily === "volatility-expansion-break"
    ) {
      directionRegimeGenes = variantIndex % 2 === 0 ? [true, false, false] : [false, true, false];
    } else if (
      presetFamily === "spread-shock-fade" ||
      presetFamily === "liquidity-vacuum-snapback" ||
      presetFamily === "bollinger-zscore-reversion" ||
      presetFamily === "low-price-capitulation-rebound" ||
      presetFamily === "token-pressure-reversal"
    ) {
      directionRegimeGenes = [false, false, true];
    }

    return directionRegimeGenes;
  }

  private createPresetVolatilityRegimeGenes(presetFamily: PresetFamilyId, variantIndex: number): VolatilityRegimeGenes {
    let volatilityRegimeGenes: VolatilityRegimeGenes = [true, true, true];

    if (
      presetFamily === "spread-compression-burst" ||
      presetFamily === "early-breakout-ramp" ||
      presetFamily === "volatility-expansion-break" ||
      presetFamily === "imbalance-flip-chase"
    ) {
      volatilityRegimeGenes = [true, true, false];
    } else if (presetFamily === "calm-range-drift" || presetFamily === "bollinger-zscore-reversion") {
      volatilityRegimeGenes = [false, true, true];
    } else if (variantIndex % 5 === 4) {
      volatilityRegimeGenes = [false, true, false];
    }

    return volatilityRegimeGenes;
  }

  private createPresetEntryPolicy(presetFamily: PresetFamilyId, variantIndex: number): EntryPolicy {
    const entryPolicy: EntryPolicy = {
      minEdgeBps: 35 + (variantIndex % 5) * 5 + (presetFamily.includes("late") ? 10 : 0),
      minNetEvUsd: Number((0.08 + (variantIndex % 5) * 0.01 + (presetFamily.includes("late") ? 0.02 : 0)).toFixed(2)),
      minConfirmations: 2 + (variantIndex % 2),
      maxSpreadPenaltyBps: 30 + (4 - (variantIndex % 5)) * 10,
      maxSlippageBps: Math.min(config.QMON_MAX_ENTRY_SLIPPAGE_BPS, 45 + (variantIndex % 5) * 8),
      minFillQuality: Number((0.5 + (variantIndex % 4) * 0.04).toFixed(2)),
      allowNoTrigger: false,
    };

    return entryPolicy;
  }

  private createPresetExecutionPolicy(presetFamily: PresetFamilyId, variantIndex: number): ExecutionPolicy {
    const executionPolicy: ExecutionPolicy = {
      sizeTier: presetFamily.includes("late") || presetFamily.includes("reversion") || presetFamily.includes("fade") ? 1 : variantIndex % 3 === 0 ? 2 : 1,
      maxTradesPerWindow: presetFamily === "microprice-pressure-follow" || presetFamily === "imbalance-flip-chase" ? 2 : 1,
      cooldownProfile: presetFamily.includes("late") || presetFamily.includes("reversion") || presetFamily.includes("calm") ? "patient" : "balanced",
    };

    return executionPolicy;
  }

  private createPresetExitPolicy(presetFamily: PresetFamilyId, variantIndex: number): ExitPolicy {
    const thesisInvalidationPolicy: ThesisInvalidationPolicy =
      presetFamily === "microprice-pressure-follow" || presetFamily === "imbalance-flip-chase" || presetFamily === "book-depth-wall-ride"
        ? "microstructure-failure"
        : presetFamily === "early-breakout-ramp" ||
            presetFamily === "momentum-lookback-pulse" ||
            presetFamily === "high-price-continuation" ||
            presetFamily === "volatility-expansion-break"
          ? "alpha-flip"
          : "hybrid";
    const exitPolicy: ExitPolicy = {
      extremeStopLossPct: [0.12, 0.3, 0.4, 0.5][variantIndex % 4] ?? 0.3,
      extremeTakeProfitPct: 0.5,
      thesisInvalidationPolicy,
      thesisCollapseProbability: config.QMON_THESIS_COLLAPSE_PROBABILITY,
      extremeDrawdownPct: config.QMON_EXTREME_DRAWDOWN_PCT,
    };

    return exitPolicy;
  }

  private createPresetPredictiveSignalGenes(presetFamily: PresetFamilyId, variantIndex: number): readonly PredictiveSignalGene[] {
    const orientation =
      presetFamily === "spread-shock-fade" || presetFamily === "bollinger-zscore-reversion" || presetFamily === "liquidity-vacuum-snapback"
        ? "inverse"
        : "aligned";
    const predictiveSignalGenes: readonly PredictiveSignalGene[] =
      presetFamily === "momentum-lookback-pulse"
        ? [
            { signalId: "crossAssetMomentum", orientation: "aligned", weightTier: 3 },
            { signalId: "momentum", orientation: "aligned", weightTier: 2 },
          ]
        : presetFamily === "bollinger-zscore-reversion" || presetFamily === "low-price-capitulation-rebound"
          ? [
              { signalId: "meanReversion", orientation: "inverse", weightTier: 3 },
              { signalId: "distance", orientation: "inverse", weightTier: 2 },
            ]
          : [
              { signalId: "edge", orientation, weightTier: 3 },
              { signalId: variantIndex % 2 === 0 ? "momentum" : "velocity", orientation: "aligned", weightTier: 2 },
              { signalId: "distance", orientation, weightTier: 1 },
            ];

    return predictiveSignalGenes;
  }

  private createPresetMicrostructureSignalGenes(presetFamily: PresetFamilyId, variantIndex: number): readonly MicrostructureSignalGene[] {
    const microstructureSignalGenes: readonly MicrostructureSignalGene[] =
      presetFamily === "microprice-pressure-follow" || presetFamily === "book-depth-wall-ride"
        ? [
            { signalId: "microprice", orientation: "aligned", weightTier: 3 },
            { signalId: "bookDepth", orientation: "aligned", weightTier: 2 },
            { signalId: "imbalance", orientation: "aligned", weightTier: 2 },
          ]
        : presetFamily === "spread-shock-fade" || presetFamily === "liquidity-vacuum-snapback"
          ? [
              { signalId: "spread", orientation: "inverse", weightTier: 3 },
              { signalId: "bookDepth", orientation: "inverse", weightTier: 2 },
              { signalId: "staleness", orientation: "inverse", weightTier: 1 },
            ]
          : [
              { signalId: variantIndex % 2 === 0 ? "imbalance" : "microprice", orientation: "aligned", weightTier: 2 },
              { signalId: "tokenPressure", orientation: presetFamily === "token-pressure-reversal" ? "inverse" : "aligned", weightTier: 2 },
              { signalId: "spread", orientation: "inverse", weightTier: 1 },
            ];

    return microstructureSignalGenes;
  }

  private buildLegacySignalGenes(
    predictiveSignalGenes: readonly PredictiveSignalGene[],
    microstructureSignalGenes: readonly MicrostructureSignalGene[],
  ): readonly SignalGene[] {
    const signalGenes: SignalGene[] = [];

    for (const predictiveSignalGene of predictiveSignalGenes) {
      const signedWeight = predictiveSignalGene.orientation === "aligned" ? predictiveSignalGene.weightTier : -predictiveSignalGene.weightTier;
      const weights: SignalWeights =
        predictiveSignalGene.signalId === "momentum" || predictiveSignalGene.signalId === "velocity" || predictiveSignalGene.signalId === "meanReversion"
          ? { "30s": signedWeight, "2m": signedWeight, "5m": signedWeight }
          : { _default: signedWeight };
      signalGenes.push({
        signalId: predictiveSignalGene.signalId,
        weights,
      });
    }

    for (const microstructureSignalGene of microstructureSignalGenes) {
      const signedWeight = microstructureSignalGene.orientation === "aligned" ? microstructureSignalGene.weightTier : -microstructureSignalGene.weightTier;
      signalGenes.push({
        signalId: microstructureSignalGene.signalId,
        weights: { _default: signedWeight },
      });
    }

    return signalGenes;
  }

  private createPresetTriggerGenes(triggerIds: readonly string[]): readonly TriggerGene[] {
    const availableTriggerIds = [
      "consensus-flip",
      "momentum-shift",
      "breakout",
      "book-pressure",
      "acceleration-spike",
      "mispricing",
      "time-decay",
      "reversion-extreme",
      "efficiency-anomaly",
      "liquidity-shift",
      "strong-momentum",
      "strong-imbalance",
      "extreme-distance",
    ] as const;
    const triggerGenes = availableTriggerIds.map((triggerId) => ({
      triggerId,
      isEnabled: triggerIds.includes(triggerId),
    }));

    return triggerGenes;
  }

  private readScalarSignal(signalValues: Record<string, number | null | Record<string, number | null>>, signalId: string): number {
    const rawSignalValue = signalValues[signalId];
    let scalarSignalValue = 0;

    if (typeof rawSignalValue === "number") {
      scalarSignalValue = rawSignalValue;
    } else if (typeof rawSignalValue === "object" && rawSignalValue !== null) {
      const horizonSignalValues = Object.values(rawSignalValue).filter((signalValue): signalValue is number => typeof signalValue === "number");
      scalarSignalValue =
        horizonSignalValues.length > 0
          ? horizonSignalValues.reduce((signalSum, horizonSignalValue) => signalSum + horizonSignalValue, 0) / horizonSignalValues.length
          : 0;
    }

    return scalarSignalValue;
  }

  private buildPresetSignalContext(signalValues: Record<string, number | null | Record<string, number | null>>): PresetSignalContext {
    const presetSignalContext: PresetSignalContext = {
      upPrice: this.readScalarSignal(signalValues, "upPrice"),
      downPrice: this.readScalarSignal(signalValues, "downPrice"),
      edge: this.readScalarSignal(signalValues, "edge"),
      distance: this.readScalarSignal(signalValues, "distance"),
      momentum: this.readScalarSignal(signalValues, "momentum"),
      velocity: this.readScalarSignal(signalValues, "velocity"),
      meanReversion: this.readScalarSignal(signalValues, "meanReversion"),
      crossAssetMomentum: this.readScalarSignal(signalValues, "crossAssetMomentum"),
      imbalance: this.readScalarSignal(signalValues, "imbalance"),
      microprice: this.readScalarSignal(signalValues, "microprice"),
      bookDepth: this.readScalarSignal(signalValues, "bookDepth"),
      spread: this.readScalarSignal(signalValues, "spread"),
      staleness: this.readScalarSignal(signalValues, "staleness"),
      tokenPressure: this.readScalarSignal(signalValues, "tokenPressure"),
    };

    return presetSignalContext;
  }

  private countPresetSignalAgreement(context: PresetSignalContext, directionalAlpha: number): number {
    const directionMultiplier = directionalAlpha >= 0 ? 1 : -1;
    const evidenceValues = [
      context.edge,
      context.distance,
      context.momentum,
      context.velocity,
      context.meanReversion,
      context.crossAssetMomentum,
      context.imbalance,
      context.microprice,
      context.bookDepth,
      context.tokenPressure,
    ];
    const signalAgreementCount = evidenceValues.filter((signalValue) => directionMultiplier * signalValue > 0.05).length;

    return signalAgreementCount;
  }

  private resolvePresetDominantSignalGroup(context: PresetSignalContext): DominantSignalGroup {
    const predictiveMagnitude =
      Math.abs(context.edge) +
      Math.abs(context.distance) +
      Math.abs(context.momentum) +
      Math.abs(context.velocity) +
      Math.abs(context.meanReversion) +
      Math.abs(context.crossAssetMomentum);
    const microstructureMagnitude =
      Math.abs(context.imbalance) +
      Math.abs(context.microprice) +
      Math.abs(context.bookDepth) +
      Math.abs(context.spread) +
      Math.abs(context.staleness) +
      Math.abs(context.tokenPressure);
    const dominantSignalGroup =
      predictiveMagnitude === 0 && microstructureMagnitude === 0
        ? "none"
        : Math.abs(predictiveMagnitude - microstructureMagnitude) < 0.05
          ? "mixed"
          : predictiveMagnitude > microstructureMagnitude
            ? "predictive"
            : "microstructure";

    return dominantSignalGroup;
  }

  private clampAlpha(rawAlpha: number): number {
    const clampedAlpha = Math.max(-1, Math.min(1, rawAlpha));

    return clampedAlpha;
  }

  private evaluateLateThresholdSprint(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const upContinuation = (context.upPrice - presetStrategyDefinition.anchorPrice) * 4 + context.momentum + context.velocity * 0.7 + context.edge;
    const downContinuation = (context.downPrice - presetStrategyDefinition.anchorPrice) * 4 - context.momentum - context.velocity * 0.7 - context.edge;
    const directionalAlpha = this.clampAlpha((upContinuation - downContinuation) * 0.5 * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateEarlyBreakoutRamp(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const breakoutAlpha =
      context.velocity * 0.55 + context.momentum * 0.35 + context.imbalance * 0.2 + context.edge * 0.2 - Math.max(0, context.spread - presetStrategyDefinition.spreadLimit);
    const directionalAlpha = this.clampAlpha(breakoutAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateSmaCrossoverFollow(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const shortSmaProxy = context.upPrice + context.momentum * 0.08 + context.velocity * 0.05;
    const longSmaProxy = 0.5 + context.distance * 0.06;
    const crossoverAlpha = (shortSmaProxy - longSmaProxy) * 4 + context.momentum * 0.35;
    const directionalAlpha = this.clampAlpha(crossoverAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateSpreadCompressionBurst(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const compressionBoost = context.spread <= presetStrategyDefinition.spreadLimit ? 0.3 : -0.35;
    const burstAlpha = context.velocity * 0.45 + context.microprice * 0.35 + context.imbalance * 0.25 + compressionBoost;
    const directionalAlpha = this.clampAlpha(burstAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateSpreadShockFade(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const shockMagnitude = Math.max(0, context.spread - presetStrategyDefinition.spreadLimit);
    const reversalAlpha = -context.distance * 0.55 - context.meanReversion * 0.35 - context.velocity * 0.2 + shockMagnitude * 0.15;
    const directionalAlpha = this.clampAlpha(reversalAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateMicropricePressureFollow(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const pressureAlpha =
      context.microprice * 0.55 +
      context.imbalance * 0.35 +
      context.bookDepth * 0.25 +
      Math.max(0, presetStrategyDefinition.depthThreshold - Math.abs(context.spread)) * 0.2;
    const directionalAlpha = this.clampAlpha(pressureAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateImbalanceFlipChase(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const flipBoost = Math.abs(context.imbalance) >= presetStrategyDefinition.imbalanceThreshold ? context.imbalance * 0.45 : context.imbalance * 0.15;
    const directionalAlpha = this.clampAlpha((flipBoost + context.velocity * 0.35 + context.momentum * 0.25) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateBookDepthWallRide(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const wallSupport = Math.abs(context.bookDepth) >= presetStrategyDefinition.depthThreshold ? context.bookDepth * 0.4 : 0;
    const directionalAlpha = this.clampAlpha((wallSupport + context.edge * 0.35 + context.microprice * 0.25) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateLiquidityVacuumSnapback(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const vacuumPenalty = context.bookDepth < presetStrategyDefinition.depthThreshold ? 0.25 : -0.1;
    const snapbackAlpha = -context.distance * 0.45 - context.meanReversion * 0.35 - context.spread * 0.2 + vacuumPenalty;
    const directionalAlpha = this.clampAlpha(snapbackAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateStaleOracleCatchup(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const staleGate = context.staleness <= presetStrategyDefinition.stalenessLimit ? 0.2 : -0.25;
    const catchupAlpha = context.crossAssetMomentum * 0.45 + context.edge * 0.35 + context.velocity * 0.15 + staleGate;
    const directionalAlpha = this.clampAlpha(catchupAlpha * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateMomentumLookbackPulse(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const fastLookbackAlpha = context.momentum * 0.55 + context.velocity * 0.35;
    const slowLookbackAlpha = context.crossAssetMomentum * 0.35 + context.edge * 0.15;
    const directionalAlpha = this.clampAlpha((fastLookbackAlpha + slowLookbackAlpha + context.tokenPressure * 0.1) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateEdgeDistanceConfluence(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const edgeLeg = Math.abs(context.edge) >= presetStrategyDefinition.edgeThreshold ? context.edge * 0.5 : 0;
    const distanceLeg = Math.abs(context.distance) >= presetStrategyDefinition.distanceThreshold ? context.distance * 0.35 : 0;
    const directionalAlpha = this.clampAlpha((edgeLeg + distanceLeg + context.imbalance * 0.15) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateBollingerZscoreReversion(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const zScoreProxy = Math.abs(context.distance) >= presetStrategyDefinition.distanceThreshold ? context.distance * 0.65 + context.meanReversion * 0.45 : 0;
    const bandWidthBias = context.spread <= presetStrategyDefinition.spreadLimit ? 0.1 : -0.15;
    const directionalAlpha = this.clampAlpha((-zScoreProxy - context.velocity * 0.1 + bandWidthBias) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateTimeDecayConsensusDrift(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const consensusBias = (context.upPrice - context.downPrice) * 0.35 + context.edge * 0.35 + context.tokenPressure * 0.2 - context.staleness * 0.1;
    const directionalAlpha = this.clampAlpha(consensusBias * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateHighPriceContinuation(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const upBias = context.upPrice >= presetStrategyDefinition.anchorPrice ? 0.4 + context.momentum * 0.35 + context.edge * 0.25 : 0;
    const downBias = context.downPrice >= presetStrategyDefinition.anchorPrice ? 0.4 - context.momentum * 0.35 - context.edge * 0.25 : 0;
    const directionalAlpha = this.clampAlpha((upBias - downBias) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateLowPriceCapitulationRebound(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const lowPriceAnchor = 1 - presetStrategyDefinition.anchorPrice;
    const upRebound = context.upPrice <= lowPriceAnchor ? -context.distance * 0.45 - context.meanReversion * 0.25 + 0.2 : 0;
    const downRebound = context.downPrice <= lowPriceAnchor ? context.distance * 0.45 + context.meanReversion * 0.25 - 0.2 : 0;
    const directionalAlpha = this.clampAlpha((upRebound - downRebound) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateLateConsensusLockIn(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const lockBias = (context.upPrice - context.downPrice) * 0.45 + context.momentum * 0.25 + context.microprice * 0.2 + context.edge * 0.15;
    const directionalAlpha = this.clampAlpha(lockBias * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateVolatilityExpansionBreak(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const expansionPulse = Math.abs(context.velocity) >= presetStrategyDefinition.slopeThreshold ? context.velocity * 0.45 : context.velocity * 0.15;
    const directionalAlpha = this.clampAlpha((expansionPulse + context.momentum * 0.3 + context.imbalance * 0.2) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateCalmRangeDrift(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const calmBonus = context.spread <= presetStrategyDefinition.spreadLimit && context.staleness <= presetStrategyDefinition.stalenessLimit ? 0.15 : -0.2;
    const directionalAlpha = this.clampAlpha((context.edge * 0.35 + context.tokenPressure * 0.25 + context.momentum * 0.2 + calmBonus) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluateTokenPressureReversal(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    const pressureShock = Math.abs(context.tokenPressure) >= presetStrategyDefinition.pressureThreshold ? -context.tokenPressure * 0.45 : -context.tokenPressure * 0.15;
    const directionalAlpha = this.clampAlpha((pressureShock - context.distance * 0.3 - context.meanReversion * 0.2 + context.bookDepth * 0.1) * presetStrategyDefinition.alphaScale);

    return directionalAlpha;
  }

  private evaluatePresetFamilyAlpha(presetStrategyDefinition: QmonPresetStrategyDefinition, context: PresetSignalContext): number {
    let directionalAlpha = 0;

    if (presetStrategyDefinition.presetFamily === "late-threshold-sprint") {
      directionalAlpha = this.evaluateLateThresholdSprint(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "early-breakout-ramp") {
      directionalAlpha = this.evaluateEarlyBreakoutRamp(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "sma-crossover-follow") {
      directionalAlpha = this.evaluateSmaCrossoverFollow(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "spread-compression-burst") {
      directionalAlpha = this.evaluateSpreadCompressionBurst(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "spread-shock-fade") {
      directionalAlpha = this.evaluateSpreadShockFade(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "microprice-pressure-follow") {
      directionalAlpha = this.evaluateMicropricePressureFollow(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "imbalance-flip-chase") {
      directionalAlpha = this.evaluateImbalanceFlipChase(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "book-depth-wall-ride") {
      directionalAlpha = this.evaluateBookDepthWallRide(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "liquidity-vacuum-snapback") {
      directionalAlpha = this.evaluateLiquidityVacuumSnapback(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "stale-oracle-catchup") {
      directionalAlpha = this.evaluateStaleOracleCatchup(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "momentum-lookback-pulse") {
      directionalAlpha = this.evaluateMomentumLookbackPulse(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "edge-distance-confluence") {
      directionalAlpha = this.evaluateEdgeDistanceConfluence(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "bollinger-zscore-reversion") {
      directionalAlpha = this.evaluateBollingerZscoreReversion(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "time-decay-consensus-drift") {
      directionalAlpha = this.evaluateTimeDecayConsensusDrift(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "high-price-continuation") {
      directionalAlpha = this.evaluateHighPriceContinuation(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "low-price-capitulation-rebound") {
      directionalAlpha = this.evaluateLowPriceCapitulationRebound(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "late-consensus-lock-in") {
      directionalAlpha = this.evaluateLateConsensusLockIn(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "volatility-expansion-break") {
      directionalAlpha = this.evaluateVolatilityExpansionBreak(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "calm-range-drift") {
      directionalAlpha = this.evaluateCalmRangeDrift(presetStrategyDefinition, context);
    } else if (presetStrategyDefinition.presetFamily === "token-pressure-reversal") {
      directionalAlpha = this.evaluateTokenPressureReversal(presetStrategyDefinition, context);
    }

    return directionalAlpha;
  }

  /**
   * @section public:methods
   */

  public getPresetStrategyDefinitions(strategyCount = config.QMON_PRESET_QMON_COUNT): readonly QmonPresetStrategyDefinition[] {
    const presetStrategyDefinitions = this.getPresetFamilyVariantOrder().slice(0, Math.max(0, strategyCount));

    return presetStrategyDefinitions;
  }

  public getPresetStrategyDefinition(presetStrategyId: string | null | undefined): QmonPresetStrategyDefinition | null {
    const presetStrategyDefinition = presetStrategyId === null || presetStrategyId === undefined ? null : (this.presetStrategiesById.get(presetStrategyId) ?? null);

    return presetStrategyDefinition;
  }

  public createCompatibilityGenome(presetStrategyDefinition: QmonPresetStrategyDefinition): QmonGenome {
    const variantIndex = Math.max(
      0,
      Number.parseInt(presetStrategyDefinition.presetStrategyId.split("-").at(-1) ?? "1", 10) - 1,
    );
    const predictiveSignalGenes = this.createPresetPredictiveSignalGenes(presetStrategyDefinition.presetFamily as PresetFamilyId, variantIndex);
    const microstructureSignalGenes = this.createPresetMicrostructureSignalGenes(presetStrategyDefinition.presetFamily as PresetFamilyId, variantIndex);
    const genome: QmonGenome = {
      predictiveSignalGenes,
      microstructureSignalGenes,
      signalGenes: this.buildLegacySignalGenes(predictiveSignalGenes, microstructureSignalGenes),
      triggerGenes: this.createPresetTriggerGenes(presetStrategyDefinition.triggerIds),
      timeWindowGenes: presetStrategyDefinition.timeWindowGenes,
      directionRegimeGenes: presetStrategyDefinition.directionRegimeGenes,
      volatilityRegimeGenes: presetStrategyDefinition.volatilityRegimeGenes,
      exchangeWeights: [0.25, 0.25, 0.25, 0.25],
      entryPolicy: presetStrategyDefinition.entryPolicy,
      executionPolicy: presetStrategyDefinition.executionPolicy,
      exitPolicy: presetStrategyDefinition.exitPolicy,
      maxTradesPerWindow: presetStrategyDefinition.executionPolicy.maxTradesPerWindow,
      maxSlippageBps: presetStrategyDefinition.entryPolicy.maxSlippageBps,
      minScoreBuy: presetStrategyDefinition.minScoreBuy,
      minScoreSell: presetStrategyDefinition.minScoreSell,
      stopLossPct: presetStrategyDefinition.exitPolicy.extremeStopLossPct,
      takeProfitPct: presetStrategyDefinition.exitPolicy.extremeTakeProfitPct,
    };

    return genome;
  }

  public evaluatePresetSignalStrategy(
    presetStrategyDefinition: QmonPresetStrategyDefinition,
    signalValues: Record<string, number | null | Record<string, number | null>>,
    _directionRegime: DirectionRegimeValue,
    _volatilityRegime: VolatilityRegimeValue,
    _timeSegment: TimeSegment,
  ): QmonPresetSignalEvaluation {
    const presetSignalContext = this.buildPresetSignalContext(signalValues);
    const directionalAlpha = this.evaluatePresetFamilyAlpha(presetStrategyDefinition, presetSignalContext);
    const presetSignalEvaluation: QmonPresetSignalEvaluation = {
      directionalAlpha,
      signalAgreementCount: this.countPresetSignalAgreement(presetSignalContext, directionalAlpha),
      dominantSignalGroup: this.resolvePresetDominantSignalGroup(presetSignalContext),
    };

    return presetSignalEvaluation;
  }
}
