/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  BeliefKey,
  BeliefWeights,
  CooldownProfile,
  DirectionRegimeGenes,
  EntryPolicy,
  ExchangeWeights,
  ExecutionPolicy,
  ExitPolicy,
  QmonGenome,
  TimeWindowGenes,
  VolatilityRegimeGenes,
} from "./qmon.types.ts";

/**
 * @section consts
 */

const BELIEF_KEYS: readonly BeliefKey[] = [
  "spotOracleAlignment",
  "resolutionMomentum",
  "consensusPersistence",
  "microstructureStability",
  "bookFreshness",
  "marketDivergence",
] as const;
const INITIAL_POPULATION_SIZE = 200;
const SIZE_TIERS: readonly ExecutionPolicy["sizeTier"][] = [1, 2, 3] as const;
const COOLDOWN_PROFILES: readonly CooldownProfile[] = ["tight", "balanced", "patient"] as const;
const GENOME_FAMILIES = [
  "consensus-resolver",
  "trend-confirmation",
  "mean-reversion-to-settlement",
  "microstructure-skeptic",
  "high-conviction-conservative",
  "divergence-capture",
] as const;
const MIN_EXECUTABLE_RISK_BUDGET_USD = 1.05;
const FAMILY_BASE_WEIGHTS: Record<QmonGenomeFamily, BeliefWeights> = {
  "consensus-resolver": {
    spotOracleAlignment: 1.25,
    resolutionMomentum: 0.8,
    consensusPersistence: 1.2,
    microstructureStability: 0.7,
    bookFreshness: 0.9,
    marketDivergence: 0.6,
  },
  "trend-confirmation": {
    spotOracleAlignment: 0.9,
    resolutionMomentum: 1.25,
    consensusPersistence: 0.95,
    microstructureStability: 0.8,
    bookFreshness: 0.75,
    marketDivergence: 0.7,
  },
  "mean-reversion-to-settlement": {
    spotOracleAlignment: 0.85,
    resolutionMomentum: -0.7,
    consensusPersistence: -0.55,
    microstructureStability: 0.4,
    bookFreshness: 1.1,
    marketDivergence: 1.3,
  },
  "microstructure-skeptic": {
    spotOracleAlignment: 0.8,
    resolutionMomentum: 0.55,
    consensusPersistence: 0.7,
    microstructureStability: 1.25,
    bookFreshness: 1.25,
    marketDivergence: 0.5,
  },
  "high-conviction-conservative": {
    spotOracleAlignment: 1.15,
    resolutionMomentum: 0.85,
    consensusPersistence: 1.15,
    microstructureStability: 1,
    bookFreshness: 1.15,
    marketDivergence: 0.45,
  },
  "divergence-capture": {
    spotOracleAlignment: 0.7,
    resolutionMomentum: 0.45,
    consensusPersistence: 0.6,
    microstructureStability: 0.65,
    bookFreshness: 0.95,
    marketDivergence: 1.35,
  },
} as const;

/**
 * @section types
 */

type QmonGenomeFamily = (typeof GENOME_FAMILIES)[number];

/**
 * @section class
 */

export class QmonGenomeService {
  /**
   * @section constructor
   */

  public constructor() {}

  /**
   * @section factory
   */

  public static createDefault(): QmonGenomeService {
    const genomeService = new QmonGenomeService();

    return genomeService;
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
    const isSelected = Math.random() < probability;

    return isSelected;
  }

  private randomInt(minimumValue: number, maximumValue: number): number {
    const randomInteger = Math.floor(Math.random() * (maximumValue - minimumValue + 1)) + minimumValue;

    return randomInteger;
  }

  private clampNumber(value: number, minimumValue: number, maximumValue: number): number {
    const clampedValue = Math.min(maximumValue, Math.max(minimumValue, value));

    return clampedValue;
  }

  private normalizeExchangeWeights(exchangeWeights: readonly number[]): ExchangeWeights {
    const totalWeight = exchangeWeights.reduce((weightSum, exchangeWeight) => weightSum + exchangeWeight, 0);
    const normalizedWeights = [exchangeWeights[0] ?? 0.25, exchangeWeights[1] ?? 0.25, exchangeWeights[2] ?? 0.25, exchangeWeights[3] ?? 0.25].map(
      (exchangeWeight) => exchangeWeight / Math.max(totalWeight, Number.EPSILON),
    ) as ExchangeWeights;

    return normalizedWeights;
  }

  private cloneBeliefWeights(beliefWeights: BeliefWeights): BeliefWeights {
    const clonedBeliefWeights: BeliefWeights = { ...beliefWeights };

    return clonedBeliefWeights;
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
      beliefWeights: this.cloneBeliefWeights(genome.beliefWeights),
      exchangeWeights: [...genome.exchangeWeights] as ExchangeWeights,
      entryPolicy: this.cloneEntryPolicy(genome.entryPolicy),
      executionPolicy: this.cloneExecutionPolicy(genome.executionPolicy),
      exitPolicy: this.cloneExitPolicy(genome.exitPolicy),
    };

    return clonedGenome;
  }

  private createBeliefWeights(family: QmonGenomeFamily, variantIndex: number): BeliefWeights {
    const baseBeliefWeights = FAMILY_BASE_WEIGHTS[family];
    const variantShift = ((variantIndex % 5) - 2) * 0.08;
    const variantBeliefWeights = {} as Record<BeliefKey, number>;

    for (const beliefKey of BELIEF_KEYS) {
      const familyWeight = baseBeliefWeights[beliefKey];
      const beliefWeight = this.clampNumber(familyWeight + variantShift + ((variantIndex + beliefKey.length) % 3) * 0.03, -1.5, 1.5);
      variantBeliefWeights[beliefKey] = Number(beliefWeight.toFixed(2));
    }

    return variantBeliefWeights;
  }

  private createTimeWindowGenes(family: QmonGenomeFamily, variantIndex: number): TimeWindowGenes {
    let timeWindowGenes: TimeWindowGenes = [true, true, true];

    if (family === "trend-confirmation") {
      timeWindowGenes = [true, true, false];
    } else if (family === "mean-reversion-to-settlement" || family === "divergence-capture") {
      timeWindowGenes = [false, true, true];
    } else if (family === "high-conviction-conservative" && variantIndex % 3 === 0) {
      timeWindowGenes = [false, true, false];
    }

    return timeWindowGenes;
  }

  private createDirectionRegimeGenes(family: QmonGenomeFamily, variantIndex: number): DirectionRegimeGenes {
    let directionRegimeGenes: DirectionRegimeGenes = [true, true, true];

    if (family === "trend-confirmation") {
      directionRegimeGenes = [true, false, false];
    } else if (family === "mean-reversion-to-settlement") {
      directionRegimeGenes = [false, false, true];
    } else if (family === "divergence-capture" && variantIndex % 2 === 0) {
      directionRegimeGenes = [true, true, false];
    }

    return directionRegimeGenes;
  }

  private createVolatilityRegimeGenes(family: QmonGenomeFamily, variantIndex: number): VolatilityRegimeGenes {
    let volatilityRegimeGenes: VolatilityRegimeGenes = [true, true, true];

    if (family === "mean-reversion-to-settlement") {
      volatilityRegimeGenes = [false, true, true];
    } else if (family === "trend-confirmation" || family === "divergence-capture") {
      volatilityRegimeGenes = [true, true, false];
    } else if (family === "high-conviction-conservative" && variantIndex % 4 === 0) {
      volatilityRegimeGenes = [false, true, false];
    }

    return volatilityRegimeGenes;
  }

  private createEntryPolicy(family: QmonGenomeFamily, variantIndex: number): EntryPolicy {
    const entryPolicy: EntryPolicy = {
      confidenceThreshold: Number(this.clampNumber(0.54 + (variantIndex % 5) * 0.02 + (family === "high-conviction-conservative" ? 0.02 : 0), 0.52, 0.68).toFixed(2)),
      confirmationRequirement: Math.max(2, Math.min(4, 2 + (variantIndex % 3))),
      maxSpreadPenaltyBps: 25 + (4 - (variantIndex % 5)) * 10,
      maxSlippageBps: Math.min(config.QMON_MAX_ENTRY_SLIPPAGE_BPS, 40 + (variantIndex % 5) * 8),
      minFillQuality: Number(this.clampNumber(0.45 + (variantIndex % 4) * 0.05, 0.4, 0.75).toFixed(2)),
      uncertaintyTolerance: Number(this.clampNumber(0.48 - (variantIndex % 4) * 0.05 + (family === "microstructure-skeptic" ? 0.04 : 0), 0.25, 0.55).toFixed(2)),
    };

    return entryPolicy;
  }

  private createExecutionPolicy(family: QmonGenomeFamily, variantIndex: number): ExecutionPolicy {
    let executionPolicy: ExecutionPolicy = {
      sizeTier: SIZE_TIERS[variantIndex % SIZE_TIERS.length] ?? 1,
      maxTradesPerWindow: 1,
      cooldownProfile: COOLDOWN_PROFILES[variantIndex % COOLDOWN_PROFILES.length] ?? "balanced",
    };

    if (family === "trend-confirmation") {
      executionPolicy = {
        sizeTier: SIZE_TIERS[(variantIndex + 1) % SIZE_TIERS.length] ?? 2,
        maxTradesPerWindow: 2,
        cooldownProfile: "balanced",
      };
    } else if (family === "high-conviction-conservative") {
      executionPolicy = {
        sizeTier: 1,
        maxTradesPerWindow: 1,
        cooldownProfile: "patient",
      };
    } else if (family === "mean-reversion-to-settlement" || family === "divergence-capture") {
      executionPolicy = {
        sizeTier: 1,
        maxTradesPerWindow: 1,
        cooldownProfile: "patient",
      };
    }

    return executionPolicy;
  }

  private createExitPolicy(family: QmonGenomeFamily, variantIndex: number): ExitPolicy {
    const collapseOffset = family === "high-conviction-conservative" ? 0.03 : family === "trend-confirmation" ? -0.02 : 0;
    const drawdownOffset = family === "high-conviction-conservative" ? -0.1 : family === "mean-reversion-to-settlement" ? 0.05 : 0;
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

  private createRiskBudgetUsd(family: QmonGenomeFamily, variantIndex: number): number {
    const familyMultiplier = family === "high-conviction-conservative" ? 0.75 : family === "trend-confirmation" ? 1.15 : 1;
    const riskBudgetUsd = Number(
      this.clampNumber(
        config.QMON_MAX_ENTRY_RISK_USD * familyMultiplier + ((variantIndex % 5) - 2) * 0.15,
        MIN_EXECUTABLE_RISK_BUDGET_USD,
        config.QMON_MAX_ENTRY_RISK_USD * 2,
      ).toFixed(2),
    );

    return riskBudgetUsd;
  }

  private createFamilyGenome(family: QmonGenomeFamily, variantIndex: number): QmonGenome {
    const genome: QmonGenome = {
      beliefWeights: this.createBeliefWeights(family, variantIndex),
      timeWindowGenes: this.createTimeWindowGenes(family, variantIndex),
      directionRegimeGenes: this.createDirectionRegimeGenes(family, variantIndex),
      volatilityRegimeGenes: this.createVolatilityRegimeGenes(family, variantIndex),
      exchangeWeights: this.normalizeExchangeWeights([0.25, 0.25, 0.25, 0.25]),
      entryPolicy: this.createEntryPolicy(family, variantIndex),
      executionPolicy: this.createExecutionPolicy(family, variantIndex),
      exitPolicy: this.createExitPolicy(family, variantIndex),
      riskBudgetUsd: this.createRiskBudgetUsd(family, variantIndex),
    };

    return genome;
  }

  private mutateBeliefWeights(beliefWeights: BeliefWeights): BeliefWeights {
    const mutatedBeliefWeights = { ...beliefWeights } as Record<BeliefKey, number>;
    const selectedBeliefKey = this.pickRandom(BELIEF_KEYS);
    const nextValue = this.clampNumber(mutatedBeliefWeights[selectedBeliefKey] + (this.randomBool() ? 0.12 : -0.12), -1.5, 1.5);

    mutatedBeliefWeights[selectedBeliefKey] = Number(nextValue.toFixed(2));

    return mutatedBeliefWeights;
  }

  private mutateEntryPolicy(entryPolicy: EntryPolicy): EntryPolicy {
    const mutatedEntryPolicy: EntryPolicy = {
      confidenceThreshold: Number(this.clampNumber(entryPolicy.confidenceThreshold + (this.randomBool() ? 0.02 : -0.02), 0.52, 0.68).toFixed(2)),
      confirmationRequirement: Math.max(2, Math.min(4, entryPolicy.confirmationRequirement + (this.randomBool() ? 1 : -1))),
      maxSpreadPenaltyBps: Math.max(20, Math.min(80, entryPolicy.maxSpreadPenaltyBps + (this.randomBool() ? 10 : -10))),
      maxSlippageBps: Math.max(25, Math.min(config.QMON_MAX_ENTRY_SLIPPAGE_BPS, entryPolicy.maxSlippageBps + (this.randomBool() ? 10 : -10))),
      minFillQuality: Number(this.clampNumber(entryPolicy.minFillQuality + (this.randomBool() ? 0.05 : -0.05), 0.4, 0.75).toFixed(2)),
      uncertaintyTolerance: Number(this.clampNumber(entryPolicy.uncertaintyTolerance + (this.randomBool() ? 0.04 : -0.04), 0.25, 0.55).toFixed(2)),
    };

    return mutatedEntryPolicy;
  }

  private mutateExecutionPolicy(executionPolicy: ExecutionPolicy): ExecutionPolicy {
    const mutatedExecutionPolicy: ExecutionPolicy = {
      sizeTier: this.pickRandom(SIZE_TIERS),
      maxTradesPerWindow: Math.max(1, Math.min(config.MAX_MAX_TRADES_PER_WINDOW, executionPolicy.maxTradesPerWindow + (this.randomBool() ? 1 : -1))),
      cooldownProfile: this.pickRandom(COOLDOWN_PROFILES),
    };

    return mutatedExecutionPolicy;
  }

  private mutateExitPolicy(exitPolicy: ExitPolicy): ExitPolicy {
    const mutatedExitPolicy: ExitPolicy = {
      thesisCollapseProbability: Number(this.clampNumber(exitPolicy.thesisCollapseProbability + (this.randomBool() ? 0.03 : -0.03), 0.25, 0.55).toFixed(2)),
      extremeDrawdownPct: Number(this.clampNumber(exitPolicy.extremeDrawdownPct + (this.randomBool() ? 0.05 : -0.05), 0.55, 0.95).toFixed(2)),
    };

    return mutatedExitPolicy;
  }

  /**
   * @section public:methods
   */

  public validateGenome(genome: QmonGenome): boolean {
    const hasMeaningfulBeliefWeights = BELIEF_KEYS.some((beliefKey) => Math.abs(genome.beliefWeights[beliefKey]) >= 0.25);
    let isValidGenome = hasMeaningfulBeliefWeights;

    if (isValidGenome) {
      isValidGenome = genome.entryPolicy.confidenceThreshold >= 0.52 && genome.entryPolicy.confidenceThreshold <= 0.68;
    }

    if (isValidGenome) {
      isValidGenome = genome.entryPolicy.confirmationRequirement >= 2 && genome.entryPolicy.confirmationRequirement <= 4;
    }

    if (isValidGenome) {
      isValidGenome = genome.entryPolicy.maxSlippageBps >= 25 && genome.entryPolicy.maxSlippageBps <= config.QMON_MAX_ENTRY_SLIPPAGE_BPS;
    }

    if (isValidGenome) {
      isValidGenome = genome.executionPolicy.maxTradesPerWindow >= 1 && genome.executionPolicy.maxTradesPerWindow <= config.MAX_MAX_TRADES_PER_WINDOW;
    }

    if (isValidGenome) {
      isValidGenome = genome.riskBudgetUsd > 0;
    }

    return isValidGenome;
  }

  public generateRandomGenome(): QmonGenome {
    const randomFamily = this.pickRandom(GENOME_FAMILIES);
    const randomVariantIndex = this.randomInt(0, 19);
    const randomGenome = this.createFamilyGenome(randomFamily, randomVariantIndex);

    return randomGenome;
  }

  public generateSeededGenome(seedType: "consensus" | "momentum" | "balanced"): QmonGenome {
    let seededGenome = this.createFamilyGenome("mean-reversion-to-settlement", 6);

    if (seedType === "consensus") {
      seededGenome = this.createFamilyGenome("consensus-resolver", 4);
    } else if (seedType === "momentum") {
      seededGenome = this.createFamilyGenome("trend-confirmation", 7);
    }

    return seededGenome;
  }

  public generateInitialPopulation(populationSize = INITIAL_POPULATION_SIZE): readonly QmonGenome[] {
    const initialPopulation: QmonGenome[] = [];

    for (let index = 0; index < populationSize; index += 1) {
      const family = GENOME_FAMILIES[index % GENOME_FAMILIES.length];
      const variantIndex = Math.floor(index / GENOME_FAMILIES.length);

      if (family === undefined) {
        throw new Error("initial genome families are empty");
      }

      initialPopulation.push(this.createFamilyGenome(family, variantIndex));
    }

    return initialPopulation;
  }

  public createRandomGenome(): QmonGenome {
    const randomGenome = this.generateRandomGenome();

    return randomGenome;
  }

  public createOffspringGenome(parentAGenome: QmonGenome, parentBGenome: QmonGenome, mutationRate: number): QmonGenome {
    let offspringGenome: QmonGenome = {
      beliefWeights: this.randomBool() ? this.cloneBeliefWeights(parentAGenome.beliefWeights) : this.cloneBeliefWeights(parentBGenome.beliefWeights),
      timeWindowGenes: this.randomBool() ? parentAGenome.timeWindowGenes : parentBGenome.timeWindowGenes,
      directionRegimeGenes: this.randomBool() ? parentAGenome.directionRegimeGenes : parentBGenome.directionRegimeGenes,
      volatilityRegimeGenes: this.randomBool() ? parentAGenome.volatilityRegimeGenes : parentBGenome.volatilityRegimeGenes,
      exchangeWeights: this.normalizeExchangeWeights(this.randomBool() ? [...parentAGenome.exchangeWeights] : [...parentBGenome.exchangeWeights]),
      entryPolicy: this.randomBool() ? this.cloneEntryPolicy(parentAGenome.entryPolicy) : this.cloneEntryPolicy(parentBGenome.entryPolicy),
      executionPolicy: this.randomBool() ? this.cloneExecutionPolicy(parentAGenome.executionPolicy) : this.cloneExecutionPolicy(parentBGenome.executionPolicy),
      exitPolicy: this.randomBool() ? this.cloneExitPolicy(parentAGenome.exitPolicy) : this.cloneExitPolicy(parentBGenome.exitPolicy),
      riskBudgetUsd: this.randomBool() ? parentAGenome.riskBudgetUsd : parentBGenome.riskBudgetUsd,
    };

    if (this.randomBool(mutationRate)) {
      offspringGenome = {
        ...offspringGenome,
        beliefWeights: this.mutateBeliefWeights(offspringGenome.beliefWeights),
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
      offspringGenome = {
        ...offspringGenome,
        riskBudgetUsd: Number(
          this.clampNumber(
            offspringGenome.riskBudgetUsd + (this.randomBool() ? 0.15 : -0.15),
            MIN_EXECUTABLE_RISK_BUDGET_USD,
            config.QMON_MAX_ENTRY_RISK_USD * 2,
          ).toFixed(2),
        ),
      };
    }

    if (!this.validateGenome(offspringGenome)) {
      offspringGenome = this.cloneGenome(this.randomBool() ? parentAGenome : parentBGenome);
    }

    return offspringGenome;
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
