/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  CooldownProfile,
  DirectionRegimeGenes,
  EntryPolicy,
  ExchangeWeights,
  ExecutionPolicy,
  ExitPolicy,
  MicrostructureSignalGene,
  PredictiveSignalGene,
  QmonGenome,
  QmonSignalId,
  SignalGene,
  SignalMetadata,
  SignalOrientation,
  SignalWeightTier,
  SignalWeights,
  ThesisInvalidationPolicy,
  TimeWindowGenes,
  TriggerGene,
  VolatilityRegimeGenes,
} from "./qmon.types.ts";

/**
 * @section consts
 */

const SIGNAL_METADATA: readonly SignalMetadata[] = [
  { id: "edge", signalGroup: "predictive", isHorizonBased: false },
  { id: "distance", signalGroup: "predictive", isHorizonBased: false },
  { id: "momentum", signalGroup: "predictive", isHorizonBased: true },
  { id: "velocity", signalGroup: "predictive", isHorizonBased: true },
  { id: "meanReversion", signalGroup: "predictive", isHorizonBased: true },
  { id: "crossAssetMomentum", signalGroup: "predictive", isHorizonBased: false },
  { id: "imbalance", signalGroup: "microstructure", isHorizonBased: false },
  { id: "microprice", signalGroup: "microstructure", isHorizonBased: false },
  { id: "bookDepth", signalGroup: "microstructure", isHorizonBased: false },
  { id: "spread", signalGroup: "microstructure", isHorizonBased: false },
  { id: "staleness", signalGroup: "microstructure", isHorizonBased: false },
  { id: "tokenPressure", signalGroup: "microstructure", isHorizonBased: false },
] as const;
const PREDICTIVE_SIGNAL_IDS = SIGNAL_METADATA.filter((signalMetadata) => signalMetadata.signalGroup === "predictive").map(
  (signalMetadata) => signalMetadata.id,
) as readonly QmonSignalId[];
const MICROSTRUCTURE_SIGNAL_IDS = SIGNAL_METADATA.filter((signalMetadata) => signalMetadata.signalGroup === "microstructure").map(
  (signalMetadata) => signalMetadata.id,
) as readonly QmonSignalId[];
const AVAILABLE_TRIGGERS = [
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
const MAX_ENABLED_TRIGGERS = 2;
const MAX_PREDICTIVE_SIGNALS = 3;
const MAX_MICROSTRUCTURE_SIGNALS = 3;
const INITIAL_POPULATION_SIZE = 200;
const SIGNAL_WEIGHT_TIERS: readonly SignalWeightTier[] = [1, 2, 3] as const;
const SIGNAL_ORIENTATIONS: readonly SignalOrientation[] = ["aligned", "inverse"] as const;
const SIZE_TIERS: readonly ExecutionPolicy["sizeTier"][] = [1, 2, 3] as const;
const COOLDOWN_PROFILES: readonly CooldownProfile[] = ["tight", "balanced", "patient"] as const;
const THESIS_INVALIDATION_POLICIES: readonly ThesisInvalidationPolicy[] = ["alpha-flip", "microstructure-failure", "hybrid"] as const;
const SPREAD_PENALTY_OPTIONS = [20, 40, 60, 80] as const;
const MIN_EDGE_OPTIONS = [15, 25, 35, 50] as const;
const MIN_NET_EV_OPTIONS = [0.03, 0.05, 0.08, 0.12] as const;
const MIN_FILL_QUALITY_OPTIONS = [0.35, 0.45, 0.55, 0.65] as const;
const CONFIRMATION_OPTIONS = [2, 3] as const;
const SCORE_THRESHOLD_OPTIONS = [0.3, 0.4, 0.5, 0.6] as const;
const STOP_LOSS_OPTIONS = [0.12, 0.3, 0.4, 0.5] as const;
const TAKE_PROFIT_OPTIONS = [0.5] as const;
const _INITIAL_EXCHANGE_PATTERNS: readonly ExchangeWeights[] = [
  [0.25, 0.25, 0.25, 0.25],
  [0.4, 0.25, 0.2, 0.15],
  [0.2, 0.4, 0.25, 0.15],
  [0.15, 0.2, 0.4, 0.25],
  [0.15, 0.15, 0.25, 0.45],
] as const;
const INITIAL_TIME_WINDOW_PATTERNS: readonly TimeWindowGenes[] = [
  [true, true, true],
  [true, true, false],
  [true, false, true],
  [false, true, true],
  [false, true, false],
] as const;
const INITIAL_DIRECTION_PATTERNS: readonly DirectionRegimeGenes[] = [
  [true, true, true],
  [true, true, false],
  [true, false, true],
  [false, true, true],
  [false, false, true],
] as const;
const INITIAL_VOLATILITY_PATTERNS: readonly VolatilityRegimeGenes[] = [
  [true, true, true],
  [false, true, true],
  [true, false, true],
  [true, true, false],
  [false, true, false],
] as const;

type QmonGenomeFamily =
  | "momentum-following"
  | "mispricing-reversion"
  | "order-book-confirmation"
  | "late-window-dislocation"
  | "cross-asset-lead-lag"
  | "liquidity-vacuum-reversion"
  | "microprice-pressure-scalper"
  | "early-breakout-surge"
  | "efficiency-anomaly-reversion"
  | "time-decay-consensus";

const INITIAL_FAMILY_SECONDARY_TRIGGERS: Record<QmonGenomeFamily, readonly string[]> = {
  "momentum-following": ["strong-momentum", "momentum-shift", "acceleration-spike", "breakout"],
  "mispricing-reversion": ["reversion-extreme", "mispricing", "efficiency-anomaly", "extreme-distance"],
  "order-book-confirmation": ["liquidity-shift", "book-pressure", "consensus-flip", "efficiency-anomaly"],
  "late-window-dislocation": ["extreme-distance", "time-decay", "efficiency-anomaly", "liquidity-shift"],
  "cross-asset-lead-lag": ["consensus-flip", "strong-momentum", "breakout", "acceleration-spike"],
  "liquidity-vacuum-reversion": ["liquidity-shift", "reversion-extreme", "mispricing", "extreme-distance"],
  "microprice-pressure-scalper": ["strong-imbalance", "book-pressure", "acceleration-spike", "reversion-extreme"],
  "early-breakout-surge": ["acceleration-spike", "breakout", "strong-momentum", "momentum-shift"],
  "efficiency-anomaly-reversion": ["efficiency-anomaly", "mispricing", "reversion-extreme", "time-decay"],
  "time-decay-consensus": ["time-decay", "consensus-flip", "extreme-distance", "strong-imbalance"],
} as const;

/**
 * @section class
 */

export class QmonGenomeService {
  /**
   * @section private:attributes
   */

  private readonly signalMetadata: readonly SignalMetadata[];

  /**
   * @section constructor
   */

  public constructor(signalMetadata?: readonly SignalMetadata[]) {
    this.signalMetadata = signalMetadata ?? SIGNAL_METADATA;
  }

  /**
   * @section factory
   */

  public static createDefault(): QmonGenomeService {
    return new QmonGenomeService();
  }

  /**
   * @section private:methods
   */

  private pickRandom<T>(values: readonly T[]): T {
    const index = Math.floor(Math.random() * values.length);
    const selectedValue = values[index];

    if (selectedValue === undefined) {
      throw new Error("Cannot pick from an empty value list");
    }

    return selectedValue;
  }

  private randomBool(probability = 0.5): boolean {
    const result = Math.random() < probability;

    return result;
  }

  private randomInt(minimumValue: number, maximumValue: number): number {
    const randomInteger = Math.floor(Math.random() * (maximumValue - minimumValue + 1)) + minimumValue;

    return randomInteger;
  }

  private normalizeExchangeWeights(exchangeWeights: readonly number[]): ExchangeWeights {
    const totalWeight = exchangeWeights.reduce((weightSum, exchangeWeight) => weightSum + exchangeWeight, 0);
    const normalizedExchangeWeights = [exchangeWeights[0] ?? 0.25, exchangeWeights[1] ?? 0.25, exchangeWeights[2] ?? 0.25, exchangeWeights[3] ?? 0.25].map(
      (exchangeWeight) => exchangeWeight / Math.max(totalWeight, Number.EPSILON),
    ) as unknown as ExchangeWeights;

    return normalizedExchangeWeights;
  }

  private clonePredictiveSignalGene(signalGene: PredictiveSignalGene): PredictiveSignalGene {
    const clonedSignalGene: PredictiveSignalGene = { ...signalGene };

    return clonedSignalGene;
  }

  private cloneMicrostructureSignalGene(signalGene: MicrostructureSignalGene): MicrostructureSignalGene {
    const clonedSignalGene: MicrostructureSignalGene = { ...signalGene };

    return clonedSignalGene;
  }

  private cloneTriggerGene(triggerGene: TriggerGene): TriggerGene {
    const clonedTriggerGene: TriggerGene = { ...triggerGene };

    return clonedTriggerGene;
  }

  private cloneEntryPolicy(entryPolicy: EntryPolicy): EntryPolicy {
    const clonedEntryPolicy: EntryPolicy = { ...entryPolicy };

    return clonedEntryPolicy;
  }

  private cloneExecutionPolicy(executionPolicy: ExecutionPolicy): ExecutionPolicy {
    const clonedExecutionPolicy: ExecutionPolicy = { ...executionPolicy };

    return clonedExecutionPolicy;
  }

  private cloneExitPolicy(exitPolicy: ExitPolicy): ExitPolicy {
    const clonedExitPolicy: ExitPolicy = { ...exitPolicy };

    return clonedExitPolicy;
  }

  private cloneGenome(genome: QmonGenome): QmonGenome {
    const clonedGenome: QmonGenome = {
      ...genome,
      predictiveSignalGenes: (genome.predictiveSignalGenes ?? []).map((signalGene) => this.clonePredictiveSignalGene(signalGene)),
      microstructureSignalGenes: (genome.microstructureSignalGenes ?? []).map((signalGene) => this.cloneMicrostructureSignalGene(signalGene)),
      signalGenes: genome.signalGenes.map((signalGene) => ({ ...signalGene, weights: { ...signalGene.weights } })),
      triggerGenes: genome.triggerGenes.map((triggerGene) => this.cloneTriggerGene(triggerGene)),
      exchangeWeights: [...genome.exchangeWeights] as ExchangeWeights,
      entryPolicy: this.cloneEntryPolicy(genome.entryPolicy),
      executionPolicy: this.cloneExecutionPolicy(genome.executionPolicy),
      exitPolicy: this.cloneExitPolicy(genome.exitPolicy),
    };

    return clonedGenome;
  }

  private createSignalSubset<T extends QmonSignalId>(signalIds: readonly T[], maximumCount: number): readonly T[] {
    const shuffledSignalIds = [...signalIds].sort(() => Math.random() - 0.5);
    const targetCount = this.randomInt(1, Math.min(maximumCount, shuffledSignalIds.length));
    const selectedSignalIds = shuffledSignalIds.slice(0, targetCount);

    return selectedSignalIds;
  }

  private buildPredictiveGenes(signalIds: readonly QmonSignalId[]): readonly PredictiveSignalGene[] {
    const predictiveGenes: PredictiveSignalGene[] = [];

    for (const signalId of signalIds) {
      predictiveGenes.push({
        signalId: signalId as PredictiveSignalGene["signalId"],
        orientation: this.pickRandom(SIGNAL_ORIENTATIONS),
        weightTier: this.pickRandom(SIGNAL_WEIGHT_TIERS),
      });
    }

    return predictiveGenes;
  }

  private buildMicrostructureGenes(signalIds: readonly QmonSignalId[]): readonly MicrostructureSignalGene[] {
    const microstructureGenes: MicrostructureSignalGene[] = [];

    for (const signalId of signalIds) {
      microstructureGenes.push({
        signalId: signalId as MicrostructureSignalGene["signalId"],
        orientation: this.pickRandom(SIGNAL_ORIENTATIONS),
        weightTier: this.pickRandom(SIGNAL_WEIGHT_TIERS),
      });
    }

    return microstructureGenes;
  }

  private generateTriggerGenesForFamily(primaryTriggerId: string, secondaryTriggerId: string | null): readonly TriggerGene[] {
    const triggerGenes = AVAILABLE_TRIGGERS.map((triggerId) => ({
      triggerId,
      isEnabled: triggerId === primaryTriggerId || (secondaryTriggerId !== null && triggerId === secondaryTriggerId),
    }));

    return triggerGenes;
  }

  private buildEntryPolicy(baseIndex: number, variantIndex: number, hasTriggerBias: boolean): EntryPolicy {
    const entryPolicy: EntryPolicy = {
      minEdgeBps: MIN_EDGE_OPTIONS[(baseIndex + variantIndex) % MIN_EDGE_OPTIONS.length] ?? 25,
      minNetEvUsd: MIN_NET_EV_OPTIONS[(variantIndex + baseIndex) % MIN_NET_EV_OPTIONS.length] ?? 0.05,
      minConfirmations: CONFIRMATION_OPTIONS[(baseIndex + variantIndex) % CONFIRMATION_OPTIONS.length] ?? 2,
      maxSpreadPenaltyBps: SPREAD_PENALTY_OPTIONS[(baseIndex + variantIndex) % SPREAD_PENALTY_OPTIONS.length] ?? 40,
      maxSlippageBps: Math.min(config.MAX_MAX_SLIPPAGE_BPS, 25 + variantIndex * 75 + baseIndex * 20),
      minFillQuality: Math.max(
        0.2,
        (MIN_FILL_QUALITY_OPTIONS[(variantIndex + baseIndex) % MIN_FILL_QUALITY_OPTIONS.length] ?? 0.45) - (hasTriggerBias ? 0.05 : 0),
      ),
    };

    return entryPolicy;
  }

  private buildExecutionPolicy(baseIndex: number, variantIndex: number): ExecutionPolicy {
    const executionPolicy: ExecutionPolicy = {
      sizeTier: SIZE_TIERS[(baseIndex + variantIndex) % SIZE_TIERS.length] ?? 1,
      maxTradesPerWindow: Math.min(config.MAX_MAX_TRADES_PER_WINDOW, 1 + ((baseIndex + variantIndex) % config.MAX_MAX_TRADES_PER_WINDOW)),
      cooldownProfile: COOLDOWN_PROFILES[(variantIndex + baseIndex) % COOLDOWN_PROFILES.length] ?? "balanced",
    };

    return executionPolicy;
  }

  private buildScoreThresholds(baseIndex: number, variantIndex: number): { minScoreBuy: number; minScoreSell: number } {
    const thresholdIndex = (baseIndex + variantIndex) % SCORE_THRESHOLD_OPTIONS.length;
    const scoreThreshold = SCORE_THRESHOLD_OPTIONS[thresholdIndex] ?? 0.4;

    return {
      minScoreBuy: scoreThreshold,
      minScoreSell: scoreThreshold,
    };
  }

  private buildExitPolicy(baseIndex: number, variantIndex: number): ExitPolicy {
    const exitPolicy: ExitPolicy = {
      extremeStopLossPct: STOP_LOSS_OPTIONS[(baseIndex + variantIndex) % STOP_LOSS_OPTIONS.length] ?? 0.3,
      extremeTakeProfitPct: TAKE_PROFIT_OPTIONS[0] ?? 0.5,
      thesisInvalidationPolicy: THESIS_INVALIDATION_POLICIES[(baseIndex + variantIndex) % THESIS_INVALIDATION_POLICIES.length] ?? "hybrid",
    };

    return exitPolicy;
  }

  private createGenomeFamily(family: QmonGenomeFamily): QmonGenome {
    let predictiveSignalGenes: readonly PredictiveSignalGene[] = [];
    let microstructureSignalGenes: readonly MicrostructureSignalGene[] = [];
    let triggerGenes: readonly TriggerGene[] = [];
    let timeWindowGenes: TimeWindowGenes = [true, true, true];
    let directionRegimeGenes: DirectionRegimeGenes = [true, true, true];
    let volatilityRegimeGenes: VolatilityRegimeGenes = [true, true, true];
    const exchangeWeights: ExchangeWeights = [0.25, 0.25, 0.25, 0.25];
    let entryPolicy: EntryPolicy = this.buildEntryPolicy(0, 0, true);
    let executionPolicy: ExecutionPolicy = this.buildExecutionPolicy(0, 0);
    let exitPolicy: ExitPolicy = this.buildExitPolicy(0, 0);
    let scoreThresholds = this.buildScoreThresholds(0, 0);

    if (family === "momentum-following") {
      predictiveSignalGenes = [
        { signalId: "momentum", orientation: "aligned", weightTier: 3 },
        { signalId: "velocity", orientation: "aligned", weightTier: 2 },
        { signalId: "crossAssetMomentum", orientation: "aligned", weightTier: 1 },
      ];
      microstructureSignalGenes = [
        { signalId: "imbalance", orientation: "aligned", weightTier: 2 },
        { signalId: "microprice", orientation: "aligned", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("momentum-shift", "strong-momentum");
      directionRegimeGenes = [true, false, false];
      volatilityRegimeGenes = [true, true, false];
      entryPolicy = {
        minEdgeBps: 25,
        minNetEvUsd: 0.05,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 40,
        maxSlippageBps: 75,
        minFillQuality: 0.45,
      };
      executionPolicy = { sizeTier: 2, maxTradesPerWindow: 2, cooldownProfile: "tight" };
      exitPolicy = { extremeStopLossPct: 0.3, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "alpha-flip" };
      scoreThresholds = { minScoreBuy: 0.4, minScoreSell: 0.4 };
    } else if (family === "mispricing-reversion") {
      predictiveSignalGenes = [
        { signalId: "edge", orientation: "aligned", weightTier: 3 },
        { signalId: "distance", orientation: "inverse", weightTier: 2 },
        { signalId: "meanReversion", orientation: "inverse", weightTier: 2 },
      ];
      microstructureSignalGenes = [
        { signalId: "spread", orientation: "inverse", weightTier: 2 },
        { signalId: "bookDepth", orientation: "aligned", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("mispricing", "reversion-extreme");
      directionRegimeGenes = [true, true, true];
      volatilityRegimeGenes = [false, true, true];
      entryPolicy = {
        minEdgeBps: 35,
        minNetEvUsd: 0.08,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 30,
        maxSlippageBps: 50,
        minFillQuality: 0.5,
      };
      executionPolicy = { sizeTier: 1, maxTradesPerWindow: 1, cooldownProfile: "patient" };
      exitPolicy = { extremeStopLossPct: 0.3, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "hybrid" };
      scoreThresholds = { minScoreBuy: 0.5, minScoreSell: 0.5 };
    } else if (family === "order-book-confirmation") {
      predictiveSignalGenes = [
        { signalId: "edge", orientation: "aligned", weightTier: 2 },
        { signalId: "distance", orientation: "aligned", weightTier: 1 },
      ];
      microstructureSignalGenes = [
        { signalId: "imbalance", orientation: "aligned", weightTier: 3 },
        { signalId: "microprice", orientation: "aligned", weightTier: 2 },
        { signalId: "bookDepth", orientation: "aligned", weightTier: 2 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("book-pressure", "liquidity-shift");
      entryPolicy = {
        minEdgeBps: 20,
        minNetEvUsd: 0.05,
        minConfirmations: 3,
        maxSpreadPenaltyBps: 35,
        maxSlippageBps: 60,
        minFillQuality: 0.55,
      };
      executionPolicy = { sizeTier: 2, maxTradesPerWindow: 2, cooldownProfile: "balanced" };
      exitPolicy = { extremeStopLossPct: 0.4, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "microstructure-failure" };
      scoreThresholds = { minScoreBuy: 0.35, minScoreSell: 0.35 };
    } else if (family === "late-window-dislocation") {
      predictiveSignalGenes = [
        { signalId: "edge", orientation: "aligned", weightTier: 2 },
        { signalId: "distance", orientation: "aligned", weightTier: 3 },
        { signalId: "meanReversion", orientation: "inverse", weightTier: 1 },
      ];
      microstructureSignalGenes = [
        { signalId: "spread", orientation: "inverse", weightTier: 2 },
        { signalId: "staleness", orientation: "inverse", weightTier: 1 },
        { signalId: "tokenPressure", orientation: "aligned", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("time-decay", "extreme-distance");
      timeWindowGenes = [false, true, true];
      entryPolicy = {
        minEdgeBps: 50,
        minNetEvUsd: 0.12,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 25,
        maxSlippageBps: 40,
        minFillQuality: 0.5,
      };
      executionPolicy = { sizeTier: 1, maxTradesPerWindow: 1, cooldownProfile: "patient" };
      exitPolicy = { extremeStopLossPct: 0.5, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "hybrid" };
      scoreThresholds = { minScoreBuy: 0.55, minScoreSell: 0.55 };
    } else if (family === "cross-asset-lead-lag") {
      predictiveSignalGenes = [
        { signalId: "crossAssetMomentum", orientation: "aligned", weightTier: 3 },
        { signalId: "momentum", orientation: "aligned", weightTier: 2 },
        { signalId: "edge", orientation: "aligned", weightTier: 1 },
      ];
      microstructureSignalGenes = [
        { signalId: "tokenPressure", orientation: "aligned", weightTier: 2 },
        { signalId: "staleness", orientation: "inverse", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("strong-momentum", "consensus-flip");
      directionRegimeGenes = [false, true, true];
      volatilityRegimeGenes = [true, true, true];
      entryPolicy = {
        minEdgeBps: 25,
        minNetEvUsd: 0.06,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 45,
        maxSlippageBps: 70,
        minFillQuality: 0.45,
      };
      executionPolicy = { sizeTier: 2, maxTradesPerWindow: 2, cooldownProfile: "balanced" };
      exitPolicy = { extremeStopLossPct: 0.3, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "alpha-flip" };
      scoreThresholds = { minScoreBuy: 0.4, minScoreSell: 0.4 };
    } else if (family === "liquidity-vacuum-reversion") {
      predictiveSignalGenes = [
        { signalId: "distance", orientation: "inverse", weightTier: 3 },
        { signalId: "meanReversion", orientation: "inverse", weightTier: 2 },
      ];
      microstructureSignalGenes = [
        { signalId: "bookDepth", orientation: "inverse", weightTier: 3 },
        { signalId: "spread", orientation: "inverse", weightTier: 2 },
        { signalId: "staleness", orientation: "inverse", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("liquidity-shift", "reversion-extreme");
      timeWindowGenes = [false, true, true];
      directionRegimeGenes = [true, true, true];
      volatilityRegimeGenes = [false, true, true];
      entryPolicy = {
        minEdgeBps: 40,
        minNetEvUsd: 0.08,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 25,
        maxSlippageBps: 45,
        minFillQuality: 0.5,
      };
      executionPolicy = { sizeTier: 1, maxTradesPerWindow: 1, cooldownProfile: "patient" };
      exitPolicy = { extremeStopLossPct: 0.4, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "hybrid" };
      scoreThresholds = { minScoreBuy: 0.5, minScoreSell: 0.5 };
    } else if (family === "microprice-pressure-scalper") {
      predictiveSignalGenes = [{ signalId: "edge", orientation: "aligned", weightTier: 2 }];
      microstructureSignalGenes = [
        { signalId: "microprice", orientation: "aligned", weightTier: 3 },
        { signalId: "imbalance", orientation: "aligned", weightTier: 3 },
        { signalId: "spread", orientation: "inverse", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("book-pressure", "strong-imbalance");
      directionRegimeGenes = [true, true, true];
      volatilityRegimeGenes = [true, true, false];
      entryPolicy = {
        minEdgeBps: 20,
        minNetEvUsd: 0.04,
        minConfirmations: 3,
        maxSpreadPenaltyBps: 30,
        maxSlippageBps: 55,
        minFillQuality: 0.55,
      };
      executionPolicy = { sizeTier: 1, maxTradesPerWindow: 2, cooldownProfile: "tight" };
      exitPolicy = { extremeStopLossPct: 0.12, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "microstructure-failure" };
      scoreThresholds = { minScoreBuy: 0.35, minScoreSell: 0.35 };
    } else if (family === "early-breakout-surge") {
      predictiveSignalGenes = [
        { signalId: "velocity", orientation: "aligned", weightTier: 3 },
        { signalId: "momentum", orientation: "aligned", weightTier: 2 },
        { signalId: "distance", orientation: "aligned", weightTier: 2 },
      ];
      microstructureSignalGenes = [
        { signalId: "imbalance", orientation: "aligned", weightTier: 2 },
        { signalId: "microprice", orientation: "aligned", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("breakout", "acceleration-spike");
      timeWindowGenes = [true, true, false];
      directionRegimeGenes = [false, true, true];
      volatilityRegimeGenes = [true, true, true];
      entryPolicy = {
        minEdgeBps: 30,
        minNetEvUsd: 0.05,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 40,
        maxSlippageBps: 80,
        minFillQuality: 0.45,
      };
      executionPolicy = { sizeTier: 2, maxTradesPerWindow: 2, cooldownProfile: "tight" };
      exitPolicy = { extremeStopLossPct: 0.3, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "alpha-flip" };
      scoreThresholds = { minScoreBuy: 0.4, minScoreSell: 0.4 };
    } else if (family === "efficiency-anomaly-reversion") {
      predictiveSignalGenes = [
        { signalId: "edge", orientation: "aligned", weightTier: 3 },
        { signalId: "distance", orientation: "inverse", weightTier: 2 },
        { signalId: "meanReversion", orientation: "inverse", weightTier: 3 },
      ];
      microstructureSignalGenes = [
        { signalId: "staleness", orientation: "inverse", weightTier: 2 },
        { signalId: "spread", orientation: "inverse", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("efficiency-anomaly", "mispricing");
      directionRegimeGenes = [true, true, true];
      volatilityRegimeGenes = [false, true, true];
      entryPolicy = {
        minEdgeBps: 35,
        minNetEvUsd: 0.08,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 35,
        maxSlippageBps: 50,
        minFillQuality: 0.5,
      };
      executionPolicy = { sizeTier: 1, maxTradesPerWindow: 1, cooldownProfile: "patient" };
      exitPolicy = { extremeStopLossPct: 0.4, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "hybrid" };
      scoreThresholds = { minScoreBuy: 0.5, minScoreSell: 0.5 };
    } else {
      predictiveSignalGenes = [
        { signalId: "edge", orientation: "aligned", weightTier: 2 },
        { signalId: "crossAssetMomentum", orientation: "aligned", weightTier: 1 },
      ];
      microstructureSignalGenes = [
        { signalId: "tokenPressure", orientation: "aligned", weightTier: 2 },
        { signalId: "spread", orientation: "inverse", weightTier: 1 },
        { signalId: "staleness", orientation: "inverse", weightTier: 1 },
      ];
      triggerGenes = this.generateTriggerGenesForFamily("time-decay", "consensus-flip");
      timeWindowGenes = [false, true, true];
      directionRegimeGenes = [true, true, true];
      volatilityRegimeGenes = [true, true, true];
      entryPolicy = {
        minEdgeBps: 30,
        minNetEvUsd: 0.06,
        minConfirmations: 2,
        maxSpreadPenaltyBps: 35,
        maxSlippageBps: 45,
        minFillQuality: 0.45,
      };
      executionPolicy = { sizeTier: 1, maxTradesPerWindow: 1, cooldownProfile: "balanced" };
      exitPolicy = { extremeStopLossPct: 0.3, extremeTakeProfitPct: 0.5, thesisInvalidationPolicy: "hybrid" };
      scoreThresholds = { minScoreBuy: 0.45, minScoreSell: 0.45 };
    }

    return {
      predictiveSignalGenes,
      microstructureSignalGenes,
      signalGenes: this.buildLegacySignalGenes(predictiveSignalGenes, microstructureSignalGenes),
      triggerGenes,
      timeWindowGenes,
      directionRegimeGenes,
      volatilityRegimeGenes,
      exchangeWeights,
      entryPolicy,
      executionPolicy,
      exitPolicy,
      maxTradesPerWindow: executionPolicy.maxTradesPerWindow,
      maxSlippageBps: entryPolicy.maxSlippageBps,
      minScoreBuy: scoreThresholds.minScoreBuy,
      minScoreSell: scoreThresholds.minScoreSell,
      stopLossPct: exitPolicy.extremeStopLossPct,
      takeProfitPct: exitPolicy.extremeTakeProfitPct,
    };
  }

  private clampNumber(value: number, minimumValue: number, maximumValue: number): number {
    const clampedValue = Math.min(maximumValue, Math.max(minimumValue, value));

    return clampedValue;
  }

  private createInitialPopulationEntryPolicy(baseGenome: QmonGenome, family: QmonGenomeFamily, variantIndex: number): EntryPolicy {
    const variantOffset = (variantIndex % 5) - 2;
    let minEdgeBps = Math.round(this.clampNumber(baseGenome.entryPolicy.minEdgeBps + variantOffset * 5, 15, 60));
    let minNetEvUsd = Number(this.clampNumber(baseGenome.entryPolicy.minNetEvUsd + variantOffset * 0.01, 0.03, 0.12).toFixed(2));
    const minConfirmations = family === "order-book-confirmation" ? 3 : baseGenome.entryPolicy.minConfirmations;
    const maxSpreadPenaltyBps = Math.round(
      this.clampNumber(baseGenome.entryPolicy.maxSpreadPenaltyBps + variantOffset * 5, 20, 80),
    );
    let maxSlippageBps = Math.round(
      this.clampNumber(baseGenome.entryPolicy.maxSlippageBps + variantOffset * 10, 25, config.MAX_MAX_SLIPPAGE_BPS),
    );
    let minFillQuality = Number(this.clampNumber(baseGenome.entryPolicy.minFillQuality + variantOffset * 0.05, 0.35, 0.7).toFixed(2));

    if (family === "order-book-confirmation" || family === "microprice-pressure-scalper") {
      minFillQuality = Number(Math.max(minFillQuality, 0.5).toFixed(2));
    }

    if (family === "late-window-dislocation" || family === "time-decay-consensus") {
      minEdgeBps = Math.round(Math.max(minEdgeBps, 40));
      minNetEvUsd = Number(Math.max(minNetEvUsd, 0.08).toFixed(2));
      maxSlippageBps = Math.round(Math.min(maxSlippageBps, 75));
    } else if (family === "mispricing-reversion" || family === "liquidity-vacuum-reversion" || family === "efficiency-anomaly-reversion") {
      minNetEvUsd = Number(this.clampNumber(minNetEvUsd, 0.05, 0.12).toFixed(2));
      maxSlippageBps = Math.round(Math.min(maxSlippageBps, 75));
    } else if (family === "momentum-following" || family === "cross-asset-lead-lag" || family === "early-breakout-surge") {
      minNetEvUsd = Number(this.clampNumber(minNetEvUsd, 0.03, 0.1).toFixed(2));
      maxSlippageBps = Math.round(Math.max(maxSlippageBps, 50));
    }

    const entryPolicy: EntryPolicy = {
      minEdgeBps,
      minNetEvUsd,
      minConfirmations,
      maxSpreadPenaltyBps,
      maxSlippageBps,
      minFillQuality,
    };

    return entryPolicy;
  }

  private createInitialPopulationExecutionPolicy(baseGenome: QmonGenome, family: QmonGenomeFamily, variantIndex: number): ExecutionPolicy {
    const sizeTier = SIZE_TIERS[(SIZE_TIERS.indexOf(baseGenome.executionPolicy.sizeTier) + variantIndex) % SIZE_TIERS.length] ?? baseGenome.executionPolicy.sizeTier;
    let maxTradesPerWindow = baseGenome.executionPolicy.maxTradesPerWindow;
    let cooldownProfile = baseGenome.executionPolicy.cooldownProfile;

    if (family === "momentum-following" || family === "cross-asset-lead-lag" || family === "early-breakout-surge") {
      maxTradesPerWindow = 2 + (variantIndex % 2);
      cooldownProfile = variantIndex % 3 === 0 ? "balanced" : "tight";
    } else if (family === "order-book-confirmation" || family === "microprice-pressure-scalper") {
      maxTradesPerWindow = 1 + (variantIndex % 2);
      cooldownProfile = "balanced";
    } else {
      maxTradesPerWindow = 1;
      cooldownProfile = "patient";
    }

    const executionPolicy: ExecutionPolicy = {
      sizeTier,
      maxTradesPerWindow,
      cooldownProfile,
    };

    return executionPolicy;
  }

  private createInitialPopulationExitPolicy(baseGenome: QmonGenome, family: QmonGenomeFamily, variantIndex: number): ExitPolicy {
    const stopLossOffset = STOP_LOSS_OPTIONS[variantIndex % STOP_LOSS_OPTIONS.length] ?? baseGenome.exitPolicy.extremeStopLossPct;
    let thesisInvalidationPolicy = baseGenome.exitPolicy.thesisInvalidationPolicy;

    if (family === "momentum-following" || family === "cross-asset-lead-lag" || family === "early-breakout-surge") {
      thesisInvalidationPolicy = "alpha-flip";
    } else if (family === "order-book-confirmation" || family === "microprice-pressure-scalper") {
      thesisInvalidationPolicy = "microstructure-failure";
    } else {
      thesisInvalidationPolicy = "hybrid";
    }

    const exitPolicy: ExitPolicy = {
      extremeStopLossPct: stopLossOffset,
      extremeTakeProfitPct: baseGenome.exitPolicy.extremeTakeProfitPct,
      thesisInvalidationPolicy,
    };

    return exitPolicy;
  }

  private createInitialPopulationScoreThresholds(baseGenome: QmonGenome, family: QmonGenomeFamily, variantIndex: number): {
    minScoreBuy: number;
    minScoreSell: number;
  } {
    const thresholdShift = ((variantIndex % 3) - 1) * 0.05;
    const minimumScoreFloor = family === "late-window-dislocation" || family === "time-decay-consensus" ? 0.45 : 0.3;
    const scoreThresholds = {
      minScoreBuy: Number(this.clampNumber(baseGenome.minScoreBuy + thresholdShift, minimumScoreFloor, 0.65).toFixed(2)),
      minScoreSell: Number(this.clampNumber(baseGenome.minScoreSell + thresholdShift, minimumScoreFloor, 0.65).toFixed(2)),
    };

    return scoreThresholds;
  }

  private createInitialPopulationTimeWindowGenes(baseGenome: QmonGenome, family: QmonGenomeFamily, baseIndex: number, variantIndex: number): TimeWindowGenes {
    const basePattern = INITIAL_TIME_WINDOW_PATTERNS[(baseIndex + variantIndex) % INITIAL_TIME_WINDOW_PATTERNS.length] ?? baseGenome.timeWindowGenes;
    let timeWindowGenes: TimeWindowGenes = [...basePattern] as TimeWindowGenes;

    if (family === "late-window-dislocation" || family === "time-decay-consensus" || family === "liquidity-vacuum-reversion") {
      timeWindowGenes = [false, true, true];
    }

    return timeWindowGenes;
  }

  private createInitialPopulationDirectionRegimeGenes(baseGenome: QmonGenome, family: QmonGenomeFamily, baseIndex: number, variantIndex: number): DirectionRegimeGenes {
    const basePattern = INITIAL_DIRECTION_PATTERNS[(baseIndex + variantIndex) % INITIAL_DIRECTION_PATTERNS.length] ?? baseGenome.directionRegimeGenes;
    let directionRegimeGenes: DirectionRegimeGenes = [...basePattern] as DirectionRegimeGenes;

    if (family === "momentum-following" || family === "cross-asset-lead-lag" || family === "early-breakout-surge") {
      directionRegimeGenes = [basePattern[0] ?? true, false, false];
    }

    return directionRegimeGenes;
  }

  private createInitialPopulationPredictiveSignalGenes(
    baseGenome: QmonGenome,
    family: QmonGenomeFamily,
    baseIndex: number,
    variantIndex: number,
  ): readonly PredictiveSignalGene[] {
    const predictiveSignalGenes = baseGenome.predictiveSignalGenes.map((signalGene) => ({
      ...signalGene,
      orientation:
        ((family === "momentum-following" && signalGene.signalId === "crossAssetMomentum") ||
          (family === "mispricing-reversion" && signalGene.signalId === "edge") ||
          (family === "order-book-confirmation" && signalGene.signalId === "distance") ||
          (family === "late-window-dislocation" && signalGene.signalId === "meanReversion")) &&
        variantIndex % 2 === 1
          ? (signalGene.orientation === "aligned" ? "inverse" : "aligned")
          : signalGene.orientation,
      weightTier: SIGNAL_WEIGHT_TIERS[(signalGene.weightTier + variantIndex + baseIndex - 1) % SIGNAL_WEIGHT_TIERS.length] ?? signalGene.weightTier,
    })) as readonly PredictiveSignalGene[];

    return predictiveSignalGenes;
  }

  private createInitialPopulationMicrostructureSignalGenes(
    baseGenome: QmonGenome,
    family: QmonGenomeFamily,
    baseIndex: number,
    variantIndex: number,
  ): readonly MicrostructureSignalGene[] {
    const microstructureSignalGenes = baseGenome.microstructureSignalGenes.map((signalGene) => ({
      ...signalGene,
      orientation:
        ((family === "momentum-following" && signalGene.signalId === "microprice") ||
          (family === "mispricing-reversion" && signalGene.signalId === "bookDepth") ||
          (family === "late-window-dislocation" && signalGene.signalId === "tokenPressure")) &&
        variantIndex % 2 === 1
          ? (signalGene.orientation === "aligned" ? "inverse" : "aligned")
          : signalGene.orientation,
      weightTier: SIGNAL_WEIGHT_TIERS[(signalGene.weightTier + baseIndex + variantIndex - 1) % SIGNAL_WEIGHT_TIERS.length] ?? signalGene.weightTier,
    })) as readonly MicrostructureSignalGene[];

    return microstructureSignalGenes;
  }

  private createInitialPopulationTriggerGenes(baseGenome: QmonGenome, family: QmonGenomeFamily, variantIndex: number): readonly TriggerGene[] {
    const baseTriggerIds = baseGenome.triggerGenes.filter((triggerGene) => triggerGene.isEnabled).map((triggerGene) => triggerGene.triggerId);
    const primaryTriggerId = baseTriggerIds[0] ?? "mispricing";
    const fallbackSecondaryTriggerId = baseTriggerIds[1] ?? null;
    const secondaryTriggerOptions = INITIAL_FAMILY_SECONDARY_TRIGGERS[family];
    const selectedSecondaryTriggerId =
      variantIndex % 2 === 0
        ? fallbackSecondaryTriggerId
        : (secondaryTriggerOptions[(Math.floor(variantIndex / 2) + variantIndex) % secondaryTriggerOptions.length] ?? fallbackSecondaryTriggerId);
    const triggerGenes = this.generateTriggerGenesForFamily(
      primaryTriggerId,
      selectedSecondaryTriggerId !== primaryTriggerId ? selectedSecondaryTriggerId : fallbackSecondaryTriggerId,
    );

    return triggerGenes;
  }

  private createInitialPopulationVariant(baseGenome: QmonGenome, family: QmonGenomeFamily, baseIndex: number, variantIndex: number): QmonGenome {
    const variantGenome = this.cloneGenome(baseGenome);
    const predictiveSignalGenes = this.createInitialPopulationPredictiveSignalGenes(baseGenome, family, baseIndex, variantIndex);
    const microstructureSignalGenes = this.createInitialPopulationMicrostructureSignalGenes(baseGenome, family, baseIndex, variantIndex);
    const triggerGenes = this.createInitialPopulationTriggerGenes(variantGenome, family, variantIndex);
    const rawExchangeWeights = [
      (variantGenome.exchangeWeights[0] ?? 0.25) + variantIndex * 0.01,
      (variantGenome.exchangeWeights[1] ?? 0.25) + baseIndex * 0.01,
      (variantGenome.exchangeWeights[2] ?? 0.25) + (variantIndex % 3) * 0.01,
      Math.max(0.05, (variantGenome.exchangeWeights[3] ?? 0.25) - variantIndex * 0.005),
    ];
    const entryPolicy = this.createInitialPopulationEntryPolicy(baseGenome, family, variantIndex);
    const executionPolicy = this.createInitialPopulationExecutionPolicy(baseGenome, family, variantIndex);
    const exitPolicy = this.createInitialPopulationExitPolicy(baseGenome, family, variantIndex);
    const scoreThresholds = this.createInitialPopulationScoreThresholds(baseGenome, family, variantIndex);
    const variant: QmonGenome = {
      predictiveSignalGenes,
      microstructureSignalGenes,
      signalGenes: this.buildLegacySignalGenes(predictiveSignalGenes, microstructureSignalGenes),
      triggerGenes,
      timeWindowGenes: this.createInitialPopulationTimeWindowGenes(baseGenome, family, baseIndex, variantIndex),
      directionRegimeGenes: this.createInitialPopulationDirectionRegimeGenes(baseGenome, family, baseIndex, variantIndex),
      volatilityRegimeGenes:
        INITIAL_VOLATILITY_PATTERNS[(baseIndex + variantIndex) % INITIAL_VOLATILITY_PATTERNS.length] ?? variantGenome.volatilityRegimeGenes,
      exchangeWeights: this.normalizeExchangeWeights(rawExchangeWeights),
      entryPolicy,
      executionPolicy,
      exitPolicy,
      maxTradesPerWindow: executionPolicy.maxTradesPerWindow,
      maxSlippageBps: entryPolicy.maxSlippageBps,
      minScoreBuy: scoreThresholds.minScoreBuy,
      minScoreSell: scoreThresholds.minScoreSell,
      stopLossPct: exitPolicy.extremeStopLossPct,
      takeProfitPct: exitPolicy.extremeTakeProfitPct,
    };

    return variant;
  }

  private countEnabledTriggers(triggerGenes: readonly TriggerGene[]): number {
    const enabledTriggerCount = triggerGenes.filter((triggerGene) => triggerGene.isEnabled).length;

    return enabledTriggerCount;
  }

  private mutatePredictiveSignalGenes(signalGenes: readonly PredictiveSignalGene[]): readonly PredictiveSignalGene[] {
    const workingSignalGenes = signalGenes.map((signalGene) => this.clonePredictiveSignalGene(signalGene));

    if (this.randomBool(0.25) && workingSignalGenes.length < MAX_PREDICTIVE_SIGNALS) {
      const availableSignalIds = PREDICTIVE_SIGNAL_IDS.filter((signalId) => !workingSignalGenes.some((signalGene) => signalGene.signalId === signalId));
      const selectedSignalId = availableSignalIds[0] ?? null;

      if (selectedSignalId !== null) {
        workingSignalGenes.push({
          signalId: selectedSignalId as PredictiveSignalGene["signalId"],
          orientation: this.pickRandom(SIGNAL_ORIENTATIONS),
          weightTier: this.pickRandom(SIGNAL_WEIGHT_TIERS),
        });
      }
    } else if (this.randomBool(0.2) && workingSignalGenes.length > 1) {
      workingSignalGenes.pop();
    } else if (workingSignalGenes.length > 0) {
      const selectedIndex = this.randomInt(0, workingSignalGenes.length - 1);
      const selectedSignalGene = workingSignalGenes[selectedIndex];

      if (selectedSignalGene !== undefined) {
        workingSignalGenes[selectedIndex] = {
          ...selectedSignalGene,
          orientation: this.randomBool(0.5) ? (selectedSignalGene.orientation === "aligned" ? "inverse" : "aligned") : selectedSignalGene.orientation,
          weightTier: this.pickRandom(SIGNAL_WEIGHT_TIERS),
        };
      }
    }

    return workingSignalGenes;
  }

  private mutateMicrostructureSignalGenes(signalGenes: readonly MicrostructureSignalGene[]): readonly MicrostructureSignalGene[] {
    const workingSignalGenes = signalGenes.map((signalGene) => this.cloneMicrostructureSignalGene(signalGene));

    if (this.randomBool(0.25) && workingSignalGenes.length < MAX_MICROSTRUCTURE_SIGNALS) {
      const availableSignalIds = MICROSTRUCTURE_SIGNAL_IDS.filter((signalId) => !workingSignalGenes.some((signalGene) => signalGene.signalId === signalId));
      const selectedSignalId = availableSignalIds[0] ?? null;

      if (selectedSignalId !== null) {
        workingSignalGenes.push({
          signalId: selectedSignalId as MicrostructureSignalGene["signalId"],
          orientation: this.pickRandom(SIGNAL_ORIENTATIONS),
          weightTier: this.pickRandom(SIGNAL_WEIGHT_TIERS),
        });
      }
    } else if (this.randomBool(0.2) && workingSignalGenes.length > 1) {
      workingSignalGenes.pop();
    } else if (workingSignalGenes.length > 0) {
      const selectedIndex = this.randomInt(0, workingSignalGenes.length - 1);
      const selectedSignalGene = workingSignalGenes[selectedIndex];

      if (selectedSignalGene !== undefined) {
        workingSignalGenes[selectedIndex] = {
          ...selectedSignalGene,
          orientation: this.randomBool(0.5) ? (selectedSignalGene.orientation === "aligned" ? "inverse" : "aligned") : selectedSignalGene.orientation,
          weightTier: this.pickRandom(SIGNAL_WEIGHT_TIERS),
        };
      }
    }

    return workingSignalGenes;
  }

  private mutateTriggerGenes(triggerGenes: readonly TriggerGene[]): readonly TriggerGene[] {
    const mutatedTriggerGenes = triggerGenes.map((triggerGene) => this.cloneTriggerGene(triggerGene));

    if (this.randomBool(0.3)) {
      const selectedTriggerId = this.pickRandom(AVAILABLE_TRIGGERS);

      for (let index = 0; index < mutatedTriggerGenes.length; index += 1) {
        const currentTriggerGene = mutatedTriggerGenes[index];

        if (currentTriggerGene !== undefined && currentTriggerGene.triggerId === selectedTriggerId) {
          mutatedTriggerGenes[index] = {
            ...currentTriggerGene,
            isEnabled: !currentTriggerGene.isEnabled,
          };
        }
      }
    }

    const enabledTriggerGenes = mutatedTriggerGenes.filter((triggerGene) => triggerGene.isEnabled);

    if (enabledTriggerGenes.length > MAX_ENABLED_TRIGGERS) {
      for (let index = MAX_ENABLED_TRIGGERS; index < enabledTriggerGenes.length; index += 1) {
        const extraTriggerGene = enabledTriggerGenes[index];

        if (extraTriggerGene !== undefined) {
          const targetIndex = mutatedTriggerGenes.findIndex((triggerGene) => triggerGene.triggerId === extraTriggerGene.triggerId);

          if (targetIndex >= 0) {
            mutatedTriggerGenes[targetIndex] = {
              ...extraTriggerGene,
              isEnabled: false,
            };
          }
        }
      }
    }

    if (this.countEnabledTriggers(mutatedTriggerGenes) === 0) {
      const targetIndex = mutatedTriggerGenes.findIndex((triggerGene) => triggerGene.triggerId === "mispricing");

      if (targetIndex >= 0) {
        const fallbackTriggerGene = mutatedTriggerGenes[targetIndex];

        if (fallbackTriggerGene !== undefined) {
          mutatedTriggerGenes[targetIndex] = {
            ...fallbackTriggerGene,
            isEnabled: true,
          };
        }
      }
    }

    return mutatedTriggerGenes;
  }

  private mutateEntryPolicy(entryPolicy: EntryPolicy): EntryPolicy {
    const mutatedEntryPolicy: EntryPolicy = {
      minEdgeBps: this.pickRandom(MIN_EDGE_OPTIONS),
      minNetEvUsd: this.pickRandom(MIN_NET_EV_OPTIONS),
      minConfirmations: this.pickRandom(CONFIRMATION_OPTIONS),
      maxSpreadPenaltyBps: this.pickRandom(SPREAD_PENALTY_OPTIONS),
      maxSlippageBps: Math.max(25, Math.min(config.MAX_MAX_SLIPPAGE_BPS, entryPolicy.maxSlippageBps + (this.randomBool(0.5) ? 25 : -25))),
      minFillQuality: this.pickRandom(MIN_FILL_QUALITY_OPTIONS),
    };

    return mutatedEntryPolicy;
  }

  private mutateExecutionPolicy(executionPolicy: ExecutionPolicy): ExecutionPolicy {
    const mutatedExecutionPolicy: ExecutionPolicy = {
      sizeTier: this.pickRandom(SIZE_TIERS),
      maxTradesPerWindow: Math.max(1, Math.min(config.MAX_MAX_TRADES_PER_WINDOW, executionPolicy.maxTradesPerWindow + (this.randomBool(0.5) ? 1 : -1))),
      cooldownProfile: this.pickRandom(COOLDOWN_PROFILES),
    };

    return mutatedExecutionPolicy;
  }

  private mutateExitPolicy(_exitPolicy: ExitPolicy): ExitPolicy {
    const mutatedExitPolicy: ExitPolicy = {
      extremeStopLossPct: this.pickRandom(STOP_LOSS_OPTIONS),
      extremeTakeProfitPct: this.pickRandom(TAKE_PROFIT_OPTIONS),
      thesisInvalidationPolicy: this.pickRandom(THESIS_INVALIDATION_POLICIES),
    };

    return mutatedExitPolicy;
  }

  private buildLegacySignalGenes(
    predictiveSignalGenes: readonly PredictiveSignalGene[],
    microstructureSignalGenes: readonly MicrostructureSignalGene[],
  ): readonly SignalGene[] {
    const legacySignalGenes: SignalGene[] = [];

    for (const predictiveSignalGene of predictiveSignalGenes) {
      const signedWeight = predictiveSignalGene.orientation === "aligned" ? predictiveSignalGene.weightTier : -predictiveSignalGene.weightTier;
      const weights: SignalWeights =
        predictiveSignalGene.signalId === "momentum" || predictiveSignalGene.signalId === "velocity" || predictiveSignalGene.signalId === "meanReversion"
          ? { "30s": signedWeight, "2m": signedWeight, "5m": signedWeight }
          : { _default: signedWeight };
      legacySignalGenes.push({
        signalId: predictiveSignalGene.signalId,
        weights,
      });
    }

    for (const microstructureSignalGene of microstructureSignalGenes) {
      const signedWeight = microstructureSignalGene.orientation === "aligned" ? microstructureSignalGene.weightTier : -microstructureSignalGene.weightTier;
      legacySignalGenes.push({
        signalId: microstructureSignalGene.signalId,
        weights: { _default: signedWeight },
      });
    }

    return legacySignalGenes;
  }

  /**
   * @section public:methods
   */

  public getSignalMetadata(): readonly SignalMetadata[] {
    return this.signalMetadata;
  }

  public getSignalInfo(signalId: string): SignalMetadata | null {
    const signalMetadata = this.signalMetadata.find((metadata) => metadata.id === signalId) ?? null;

    return signalMetadata;
  }

  public getAvailableTriggers(): readonly string[] {
    return AVAILABLE_TRIGGERS;
  }

  public validateSignalGene(signalGene: PredictiveSignalGene | MicrostructureSignalGene): boolean {
    const signalMetadata = this.getSignalInfo(signalGene.signalId);
    let isValidSignalGene = signalMetadata !== null;

    if (isValidSignalGene) {
      isValidSignalGene = signalGene.weightTier >= 1 && signalGene.weightTier <= 3;
    }

    return isValidSignalGene;
  }

  public validateGenome(genome: QmonGenome): boolean {
    let isValidGenome = genome.predictiveSignalGenes.length > 0 && genome.predictiveSignalGenes.length <= MAX_PREDICTIVE_SIGNALS;

    if (isValidGenome) {
      isValidGenome = genome.microstructureSignalGenes.length > 0 && genome.microstructureSignalGenes.length <= MAX_MICROSTRUCTURE_SIGNALS;
    }

    if (isValidGenome) {
      isValidGenome = genome.predictiveSignalGenes.every((signalGene) => this.validateSignalGene(signalGene));
    }

    if (isValidGenome) {
      isValidGenome = genome.microstructureSignalGenes.every((signalGene) => this.validateSignalGene(signalGene));
    }

    if (isValidGenome) {
      isValidGenome = this.countEnabledTriggers(genome.triggerGenes) <= MAX_ENABLED_TRIGGERS;
    }

    if (isValidGenome) {
      isValidGenome = genome.entryPolicy.maxSlippageBps >= 25 && genome.entryPolicy.maxSlippageBps <= config.MAX_MAX_SLIPPAGE_BPS;
    }

    if (isValidGenome) {
      isValidGenome = genome.executionPolicy.maxTradesPerWindow >= 1 && genome.executionPolicy.maxTradesPerWindow <= config.MAX_MAX_TRADES_PER_WINDOW;
    }

    return isValidGenome;
  }

  public validateThresholds(exitPolicy: ExitPolicy): boolean {
    const isValidThresholds =
      STOP_LOSS_OPTIONS.includes(exitPolicy.extremeStopLossPct as never) && TAKE_PROFIT_OPTIONS.includes(exitPolicy.extremeTakeProfitPct as never);

    return isValidThresholds;
  }

  public generateSignalGenes(): readonly PredictiveSignalGene[] {
    const predictiveGenes = this.buildPredictiveGenes(this.createSignalSubset(PREDICTIVE_SIGNAL_IDS, MAX_PREDICTIVE_SIGNALS));

    return predictiveGenes;
  }

  public generateTriggerGenes(density = 0.5): readonly TriggerGene[] {
    const generatedTriggerGenes = AVAILABLE_TRIGGERS.map((triggerId) => ({
      triggerId,
      isEnabled: this.randomBool(density),
    }));

    return this.mutateTriggerGenes(generatedTriggerGenes);
  }

  public generateTimeWindowGenes(): TimeWindowGenes {
    const timeWindowGenes: TimeWindowGenes = [this.randomBool(), this.randomBool(), this.randomBool()];

    return timeWindowGenes;
  }

  public generateDirectionRegimeGenes(): DirectionRegimeGenes {
    const directionRegimeGenes: DirectionRegimeGenes = [this.randomBool(), this.randomBool(), this.randomBool()];

    return directionRegimeGenes;
  }

  public generateVolatilityRegimeGenes(): VolatilityRegimeGenes {
    const volatilityRegimeGenes: VolatilityRegimeGenes = [this.randomBool(), this.randomBool(), this.randomBool()];

    return volatilityRegimeGenes;
  }

  public generateScoreThresholds(): ExitPolicy {
    const exitPolicy: ExitPolicy = {
      extremeStopLossPct: this.pickRandom(STOP_LOSS_OPTIONS),
      extremeTakeProfitPct: this.pickRandom(TAKE_PROFIT_OPTIONS),
      thesisInvalidationPolicy: this.pickRandom(THESIS_INVALIDATION_POLICIES),
    };

    return exitPolicy;
  }

  public generateRandomGenome(): QmonGenome {
    const predictiveSignalGenes = this.buildPredictiveGenes(this.createSignalSubset(PREDICTIVE_SIGNAL_IDS, MAX_PREDICTIVE_SIGNALS));
    const microstructureSignalGenes = this.buildMicrostructureGenes(this.createSignalSubset(MICROSTRUCTURE_SIGNAL_IDS, MAX_MICROSTRUCTURE_SIGNALS));
    const baseIndex = this.randomInt(0, 3);
    const variantIndex = this.randomInt(0, 3);
    const entryPolicy = this.buildEntryPolicy(baseIndex, variantIndex, true);
    const executionPolicy = this.buildExecutionPolicy(baseIndex, variantIndex);
    const exitPolicy = this.buildExitPolicy(baseIndex, variantIndex);
    const scoreThresholds = this.buildScoreThresholds(baseIndex, variantIndex);

    return {
      predictiveSignalGenes,
      microstructureSignalGenes,
      signalGenes: this.buildLegacySignalGenes(predictiveSignalGenes, microstructureSignalGenes),
      triggerGenes: this.generateTriggerGenes(0.3),
      timeWindowGenes: this.generateTimeWindowGenes(),
      directionRegimeGenes: this.generateDirectionRegimeGenes(),
      volatilityRegimeGenes: this.generateVolatilityRegimeGenes(),
      exchangeWeights: this.normalizeExchangeWeights([Math.random(), Math.random(), Math.random(), Math.random()]),
      entryPolicy,
      executionPolicy,
      exitPolicy,
      maxTradesPerWindow: executionPolicy.maxTradesPerWindow,
      maxSlippageBps: entryPolicy.maxSlippageBps,
      minScoreBuy: scoreThresholds.minScoreBuy,
      minScoreSell: scoreThresholds.minScoreSell,
      stopLossPct: exitPolicy.extremeStopLossPct,
      takeProfitPct: exitPolicy.extremeTakeProfitPct,
    };
  }

  public generateSeededGenome(seedType: "consensus" | "momentum" | "balanced"): QmonGenome {
    let seededGenome: QmonGenome;

    if (seedType === "consensus") {
      seededGenome = this.createGenomeFamily("order-book-confirmation");
    } else if (seedType === "momentum") {
      seededGenome = this.createGenomeFamily("momentum-following");
    } else {
      seededGenome = this.createGenomeFamily("mispricing-reversion");
    }

    return seededGenome;
  }

  public generateInitialPopulation(populationSize = INITIAL_POPULATION_SIZE): readonly QmonGenome[] {
    const baseFamilies: readonly { family: QmonGenomeFamily; genome: QmonGenome }[] = [
      { family: "momentum-following", genome: this.createGenomeFamily("momentum-following") },
      { family: "mispricing-reversion", genome: this.createGenomeFamily("mispricing-reversion") },
      { family: "order-book-confirmation", genome: this.createGenomeFamily("order-book-confirmation") },
      { family: "late-window-dislocation", genome: this.createGenomeFamily("late-window-dislocation") },
      { family: "cross-asset-lead-lag", genome: this.createGenomeFamily("cross-asset-lead-lag") },
      { family: "liquidity-vacuum-reversion", genome: this.createGenomeFamily("liquidity-vacuum-reversion") },
      { family: "microprice-pressure-scalper", genome: this.createGenomeFamily("microprice-pressure-scalper") },
      { family: "early-breakout-surge", genome: this.createGenomeFamily("early-breakout-surge") },
      { family: "efficiency-anomaly-reversion", genome: this.createGenomeFamily("efficiency-anomaly-reversion") },
      { family: "time-decay-consensus", genome: this.createGenomeFamily("time-decay-consensus") },
    ];
    const initialPopulation: QmonGenome[] = [];

    for (let index = 0; index < populationSize; index += 1) {
      const baseIndex = index % baseFamilies.length;
      const variantIndex = Math.floor(index / baseFamilies.length);
      const baseFamily = baseFamilies[baseIndex];

      if (baseFamily === undefined) {
        throw new Error("initial genome families are empty");
      }

      initialPopulation.push(this.createInitialPopulationVariant(baseFamily.genome, baseFamily.family, baseIndex, variantIndex));
    }

    return initialPopulation;
  }

  public createOffspringGenome(parentAGenome: QmonGenome, parentBGenome: QmonGenome, mutationRate: number): QmonGenome {
    let offspringGenome: QmonGenome = {
      predictiveSignalGenes: this.randomBool() ? (parentAGenome.predictiveSignalGenes ?? []) : (parentBGenome.predictiveSignalGenes ?? []),
      microstructureSignalGenes: this.randomBool() ? (parentAGenome.microstructureSignalGenes ?? []) : (parentBGenome.microstructureSignalGenes ?? []),
      signalGenes: [],
      triggerGenes: this.randomBool() ? parentAGenome.triggerGenes : parentBGenome.triggerGenes,
      timeWindowGenes: this.randomBool() ? parentAGenome.timeWindowGenes : parentBGenome.timeWindowGenes,
      directionRegimeGenes: this.randomBool() ? parentAGenome.directionRegimeGenes : parentBGenome.directionRegimeGenes,
      volatilityRegimeGenes: this.randomBool() ? parentAGenome.volatilityRegimeGenes : parentBGenome.volatilityRegimeGenes,
      exchangeWeights: this.normalizeExchangeWeights(this.randomBool() ? [...parentAGenome.exchangeWeights] : [...parentBGenome.exchangeWeights]),
      entryPolicy: this.randomBool() ? this.cloneEntryPolicy(parentAGenome.entryPolicy) : this.cloneEntryPolicy(parentBGenome.entryPolicy),
      executionPolicy: this.randomBool() ? this.cloneExecutionPolicy(parentAGenome.executionPolicy) : this.cloneExecutionPolicy(parentBGenome.executionPolicy),
      exitPolicy: this.randomBool() ? this.cloneExitPolicy(parentAGenome.exitPolicy) : this.cloneExitPolicy(parentBGenome.exitPolicy),
      maxTradesPerWindow: (this.randomBool() ? parentAGenome.executionPolicy : parentBGenome.executionPolicy).maxTradesPerWindow,
      maxSlippageBps: (this.randomBool() ? parentAGenome.entryPolicy : parentBGenome.entryPolicy).maxSlippageBps,
      minScoreBuy: this.randomBool() ? parentAGenome.minScoreBuy : parentBGenome.minScoreBuy,
      minScoreSell: this.randomBool() ? parentAGenome.minScoreSell : parentBGenome.minScoreSell,
      stopLossPct: (this.randomBool() ? parentAGenome.exitPolicy : parentBGenome.exitPolicy).extremeStopLossPct,
      takeProfitPct: (this.randomBool() ? parentAGenome.exitPolicy : parentBGenome.exitPolicy).extremeTakeProfitPct,
    };

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        predictiveSignalGenes: this.mutatePredictiveSignalGenes(offspringGenome.predictiveSignalGenes),
      };
    }

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        microstructureSignalGenes: this.mutateMicrostructureSignalGenes(offspringGenome.microstructureSignalGenes),
      };
    }

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        triggerGenes: this.mutateTriggerGenes(offspringGenome.triggerGenes),
      };
    }

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        entryPolicy: this.mutateEntryPolicy(offspringGenome.entryPolicy),
      };
    }

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        executionPolicy: this.mutateExecutionPolicy(offspringGenome.executionPolicy),
      };
    }

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        exitPolicy: this.mutateExitPolicy(offspringGenome.exitPolicy),
      };
    }

    if (this.randomBool(mutationRate)) {
      const mutatedScoreThresholds = this.buildScoreThresholds(this.randomInt(0, 3), this.randomInt(0, 3));
      offspringGenome = {
        ...offspringGenome,
        minScoreBuy: mutatedScoreThresholds.minScoreBuy,
        minScoreSell: mutatedScoreThresholds.minScoreSell,
      };
    }

    if (!this.validateGenome(offspringGenome)) {
      offspringGenome = this.cloneGenome(this.randomBool() ? parentAGenome : parentBGenome);
    }

    return {
      ...offspringGenome,
      signalGenes: this.buildLegacySignalGenes(offspringGenome.predictiveSignalGenes, offspringGenome.microstructureSignalGenes),
      maxTradesPerWindow: offspringGenome.executionPolicy.maxTradesPerWindow,
      maxSlippageBps: offspringGenome.entryPolicy.maxSlippageBps,
      minScoreBuy: offspringGenome.minScoreBuy,
      minScoreSell: offspringGenome.minScoreSell,
      stopLossPct: offspringGenome.exitPolicy.extremeStopLossPct,
      takeProfitPct: offspringGenome.exitPolicy.extremeTakeProfitPct,
    };
  }
}

export function generateQmonId(length = 6): string {
  const idAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let generatedId = "";

  for (let index = 0; index < length; index += 1) {
    generatedId += idAlphabet[Math.floor(Math.random() * idAlphabet.length)] ?? "A";
  }

  return generatedId;
}
