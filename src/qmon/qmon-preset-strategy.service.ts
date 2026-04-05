/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  BeliefKey,
  BeliefWeights,
  DirectionRegimeGenes,
  EntryPolicy,
  ExecutionPolicy,
  ExitPolicy,
  QmonGenome,
  QmonPresetStrategyDefinition,
  TimeWindowGenes,
  VolatilityRegimeGenes,
} from "./qmon.types.ts";

/**
 * @section consts
 */

const PRESET_VARIANTS_PER_FAMILY = 20;
const PRESET_FAMILY_IDS = [
  "consensus-resolver",
  "trend-confirmation",
  "mean-reversion-to-settlement",
  "microstructure-skeptic",
  "high-conviction-conservative",
  "divergence-capture",
] as const;
const BELIEF_KEYS: readonly BeliefKey[] = [
  "spotOracleAlignment",
  "resolutionMomentum",
  "consensusPersistence",
  "microstructureStability",
  "bookFreshness",
  "marketDivergence",
] as const;
const PRESET_FAMILY_LABELS: Record<PresetFamilyId, string> = {
  "consensus-resolver": "Consensus Resolver",
  "trend-confirmation": "Trend Confirmation",
  "mean-reversion-to-settlement": "Mean Reversion To Settlement",
  "microstructure-skeptic": "Microstructure Skeptic",
  "high-conviction-conservative": "High Conviction Conservative",
  "divergence-capture": "Divergence Capture",
} as const;
const PRESET_FAMILY_BASE_WEIGHTS: Record<PresetFamilyId, BeliefWeights> = {
  "consensus-resolver": {
    spotOracleAlignment: 1.25,
    resolutionMomentum: 0.8,
    consensusPersistence: 1.2,
    microstructureStability: 0.7,
    bookFreshness: 0.95,
    marketDivergence: 0.55,
  },
  "trend-confirmation": {
    spotOracleAlignment: 0.85,
    resolutionMomentum: 1.3,
    consensusPersistence: 0.95,
    microstructureStability: 0.85,
    bookFreshness: 0.7,
    marketDivergence: 0.65,
  },
  "mean-reversion-to-settlement": {
    spotOracleAlignment: 0.8,
    resolutionMomentum: -0.7,
    consensusPersistence: -0.5,
    microstructureStability: 0.45,
    bookFreshness: 1.15,
    marketDivergence: 1.35,
  },
  "microstructure-skeptic": {
    spotOracleAlignment: 0.75,
    resolutionMomentum: 0.5,
    consensusPersistence: 0.7,
    microstructureStability: 1.3,
    bookFreshness: 1.25,
    marketDivergence: 0.45,
  },
  "high-conviction-conservative": {
    spotOracleAlignment: 1.2,
    resolutionMomentum: 0.85,
    consensusPersistence: 1.2,
    microstructureStability: 1,
    bookFreshness: 1.2,
    marketDivergence: 0.4,
  },
  "divergence-capture": {
    spotOracleAlignment: 0.7,
    resolutionMomentum: 0.45,
    consensusPersistence: 0.6,
    microstructureStability: 0.65,
    bookFreshness: 0.95,
    marketDivergence: 1.4,
  },
} as const;

/**
 * @section types
 */

type PresetFamilyId = (typeof PRESET_FAMILY_IDS)[number];

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

  private clampNumber(value: number, minimumValue: number, maximumValue: number): number {
    const clampedValue = Math.min(maximumValue, Math.max(minimumValue, value));

    return clampedValue;
  }

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

  private createBeliefWeights(presetFamily: PresetFamilyId, variantIndex: number): BeliefWeights {
    const baseBeliefWeights = PRESET_FAMILY_BASE_WEIGHTS[presetFamily];
    const variantShift = ((variantIndex % 5) - 2) * 0.08;
    const presetBeliefWeights = {} as Record<BeliefKey, number>;

    for (const beliefKey of BELIEF_KEYS) {
      const baseWeight = baseBeliefWeights[beliefKey];
      const beliefWeight = this.clampNumber(baseWeight + variantShift + ((variantIndex + beliefKey.length) % 3) * 0.03, -1.5, 1.5);
      presetBeliefWeights[beliefKey] = Number(beliefWeight.toFixed(2));
    }

    return presetBeliefWeights;
  }

  private createTimeWindowGenes(presetFamily: PresetFamilyId, variantIndex: number): TimeWindowGenes {
    let timeWindowGenes: TimeWindowGenes = [true, true, true];

    if (presetFamily === "trend-confirmation") {
      timeWindowGenes = [true, true, false];
    } else if (presetFamily === "mean-reversion-to-settlement" || presetFamily === "divergence-capture") {
      timeWindowGenes = [false, true, true];
    } else if (presetFamily === "high-conviction-conservative" && variantIndex % 3 === 0) {
      timeWindowGenes = [false, true, false];
    }

    return timeWindowGenes;
  }

  private createDirectionRegimeGenes(presetFamily: PresetFamilyId, variantIndex: number): DirectionRegimeGenes {
    let directionRegimeGenes: DirectionRegimeGenes = [true, true, true];

    if (presetFamily === "trend-confirmation") {
      directionRegimeGenes = [true, false, false];
    } else if (presetFamily === "mean-reversion-to-settlement") {
      directionRegimeGenes = [false, false, true];
    } else if (presetFamily === "divergence-capture" && variantIndex % 2 === 0) {
      directionRegimeGenes = [true, true, false];
    }

    return directionRegimeGenes;
  }

  private createVolatilityRegimeGenes(presetFamily: PresetFamilyId, variantIndex: number): VolatilityRegimeGenes {
    let volatilityRegimeGenes: VolatilityRegimeGenes = [true, true, true];

    if (presetFamily === "mean-reversion-to-settlement") {
      volatilityRegimeGenes = [false, true, true];
    } else if (presetFamily === "trend-confirmation" || presetFamily === "divergence-capture") {
      volatilityRegimeGenes = [true, true, false];
    } else if (presetFamily === "high-conviction-conservative" && variantIndex % 4 === 0) {
      volatilityRegimeGenes = [false, true, false];
    }

    return volatilityRegimeGenes;
  }

  private createEntryPolicy(presetFamily: PresetFamilyId, variantIndex: number): EntryPolicy {
    const entryPolicy: EntryPolicy = {
      confidenceThreshold: Number(this.clampNumber(0.58 + (variantIndex % 5) * 0.02 + (presetFamily === "high-conviction-conservative" ? 0.04 : 0), 0.54, 0.72).toFixed(2)),
      confirmationRequirement: Math.max(2, Math.min(4, 2 + (variantIndex % 3))),
      maxSpreadPenaltyBps: 25 + (4 - (variantIndex % 5)) * 10,
      maxSlippageBps: Math.min(config.QMON_MAX_ENTRY_SLIPPAGE_BPS, 40 + (variantIndex % 5) * 8),
      minFillQuality: Number(this.clampNumber(0.45 + (variantIndex % 4) * 0.05, 0.4, 0.75).toFixed(2)),
      uncertaintyTolerance: Number(this.clampNumber(0.48 - (variantIndex % 4) * 0.05 + (presetFamily === "microstructure-skeptic" ? 0.04 : 0), 0.25, 0.55).toFixed(2)),
    };

    return entryPolicy;
  }

  private createExecutionPolicy(presetFamily: PresetFamilyId, variantIndex: number): ExecutionPolicy {
    let executionPolicy: ExecutionPolicy = {
      sizeTier: ((variantIndex % 3) + 1) as ExecutionPolicy["sizeTier"],
      maxTradesPerWindow: 1,
      cooldownProfile: variantIndex % 2 === 0 ? "balanced" : "patient",
    };

    if (presetFamily === "trend-confirmation") {
      executionPolicy = {
        sizeTier: ((variantIndex + 1) % 3 === 0 ? 3 : 2) as ExecutionPolicy["sizeTier"],
        maxTradesPerWindow: 2,
        cooldownProfile: "balanced",
      };
    } else if (presetFamily === "high-conviction-conservative") {
      executionPolicy = {
        sizeTier: 1,
        maxTradesPerWindow: 1,
        cooldownProfile: "patient",
      };
    }

    return executionPolicy;
  }

  private createExitPolicy(presetFamily: PresetFamilyId, variantIndex: number): ExitPolicy {
    const collapseOffset = presetFamily === "high-conviction-conservative" ? 0.03 : presetFamily === "trend-confirmation" ? -0.02 : 0;
    const drawdownOffset = presetFamily === "high-conviction-conservative" ? -0.1 : presetFamily === "mean-reversion-to-settlement" ? 0.05 : 0;
    const exitPolicy: ExitPolicy = {
      thesisCollapseProbability: Number(
        this.clampNumber(config.QMON_THESIS_COLLAPSE_PROBABILITY + collapseOffset + ((variantIndex % 3) - 1) * 0.03, 0.25, 0.55).toFixed(2),
      ),
      extremeDrawdownPct: Number(
        this.clampNumber(config.QMON_EXTREME_DRAWDOWN_PCT + drawdownOffset + ((variantIndex % 3) - 1) * 0.05, 0.55, 0.95).toFixed(2),
      ),
    };

    return exitPolicy;
  }

  private createRiskBudgetUsd(presetFamily: PresetFamilyId, variantIndex: number): number {
    const familyMultiplier = presetFamily === "high-conviction-conservative" ? 0.75 : presetFamily === "trend-confirmation" ? 1.15 : 1;
    const riskBudgetUsd = Number(
      this.clampNumber(config.QMON_MAX_ENTRY_RISK_USD * familyMultiplier + ((variantIndex % 5) - 2) * 0.15, 0.5, config.QMON_MAX_ENTRY_RISK_USD * 2).toFixed(2),
    );

    return riskBudgetUsd;
  }

  private createPresetDescription(presetFamily: PresetFamilyId, variantIndex: number): string {
    const variantPosture = variantIndex < 7 ? "defensive" : variantIndex < 14 ? "balanced" : "aggressive";
    let presetNarrative = "broad settlement confirmation";

    if (presetFamily === "trend-confirmation") {
      presetNarrative = "resolution trend persistence with moderated microstructure support";
    } else if (presetFamily === "mean-reversion-to-settlement") {
      presetNarrative = "late disagreement snap-back into settlement consensus";
    } else if (presetFamily === "microstructure-skeptic") {
      presetNarrative = "strict book-quality validation before trusting final-outcome conviction";
    } else if (presetFamily === "high-conviction-conservative") {
      presetNarrative = "high-confidence outcome selection with low notional risk";
    } else if (presetFamily === "divergence-capture") {
      presetNarrative = "market-vs-model dislocations that still point to a final winner";
    }

    return `${PRESET_FAMILY_LABELS[presetFamily]} preset ${variantIndex + 1}: ${variantPosture} settlement predictor tuned for ${presetNarrative}.`;
  }

  private createPresetStrategyDefinition(presetFamily: PresetFamilyId, variantIndex: number): QmonPresetStrategyDefinition {
    const presetStrategyDefinition: QmonPresetStrategyDefinition = {
      presetStrategyId: `${presetFamily}-${String(variantIndex + 1).padStart(2, "0")}`,
      presetFamily,
      strategyName: `${PRESET_FAMILY_LABELS[presetFamily]} ${String(variantIndex + 1).padStart(2, "0")}`,
      strategyDescription: this.createPresetDescription(presetFamily, variantIndex),
      beliefWeights: this.createBeliefWeights(presetFamily, variantIndex),
      timeWindowGenes: this.createTimeWindowGenes(presetFamily, variantIndex),
      directionRegimeGenes: this.createDirectionRegimeGenes(presetFamily, variantIndex),
      volatilityRegimeGenes: this.createVolatilityRegimeGenes(presetFamily, variantIndex),
      entryPolicy: this.createEntryPolicy(presetFamily, variantIndex),
      executionPolicy: this.createExecutionPolicy(presetFamily, variantIndex),
      exitPolicy: this.createExitPolicy(presetFamily, variantIndex),
      riskBudgetUsd: this.createRiskBudgetUsd(presetFamily, variantIndex),
    };

    return presetStrategyDefinition;
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
    const compatibilityGenome: QmonGenome = {
      beliefWeights: { ...presetStrategyDefinition.beliefWeights },
      timeWindowGenes: presetStrategyDefinition.timeWindowGenes,
      directionRegimeGenes: presetStrategyDefinition.directionRegimeGenes,
      volatilityRegimeGenes: presetStrategyDefinition.volatilityRegimeGenes,
      exchangeWeights: [0.25, 0.25, 0.25, 0.25],
      entryPolicy: { ...presetStrategyDefinition.entryPolicy },
      executionPolicy: { ...presetStrategyDefinition.executionPolicy },
      exitPolicy: { ...presetStrategyDefinition.exitPolicy },
      riskBudgetUsd: presetStrategyDefinition.riskBudgetUsd,
    };

    return compatibilityGenome;
  }
}
