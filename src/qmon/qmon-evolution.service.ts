/**
 * @section imports:internals
 */

import config from "../config.ts";
import { generateQmonId } from "./qmon-genome.service.ts";
import type { QmonGenomeService } from "./qmon-genome.service.ts";
import type { MarketKey, Qmon, QmonGenome, QmonId, QmonMetrics, QmonPopulation, QmonPosition } from "./qmon.types.ts";

/**
 * @section consts
 */

const MIN_PARENT_TRADES = 8;
const PARENT_POOL_RATE = 0.4;
const RANDOM_EXPLORER_RATE = 0.1;
const MIN_PARENT_POOL_SIZE = 8;
const EXPLORATORY_INJECTION_WINDOW_INTERVAL = 50;
const EXPLORATORY_INJECTION_SIZE = 20;

type EvolutionReplacement = {
  readonly childQmonId: QmonId;
  readonly deadQmonId: QmonId;
  readonly parentIds: readonly QmonId[];
  readonly generation: number;
  readonly replacementCount: number;
};

type EvolutionResult = {
  readonly population: QmonPopulation;
  readonly replacements: readonly EvolutionReplacement[];
  readonly highestChildGeneration: number | null;
};

type HydrateNewbornQmon = (newbornQmon: Qmon, currentWindowStartMs: number | null) => Qmon;

/**
 * @section class
 */

export class QmonEvolutionService {
  /**
   * @section private:attributes
   */

  private readonly genomeService: QmonGenomeService;

  /**
   * @section constructor
   */

  public constructor(genomeService: QmonGenomeService) {
    this.genomeService = genomeService;
  }

  /**
   * @section private:methods
   */

  private compareReproductiveFitness(leftQmon: Qmon, rightQmon: Qmon): number {
    let comparison = 0;
    const leftFitnessScore = leftQmon.metrics.fitnessScore ?? Number.NEGATIVE_INFINITY;
    const rightFitnessScore = rightQmon.metrics.fitnessScore ?? Number.NEGATIVE_INFINITY;

    if (leftFitnessScore !== rightFitnessScore) {
      comparison = rightFitnessScore - leftFitnessScore;
    } else if ((leftQmon.metrics.totalEstimatedNetEvUsd ?? 0) !== (rightQmon.metrics.totalEstimatedNetEvUsd ?? 0)) {
      comparison = (rightQmon.metrics.totalEstimatedNetEvUsd ?? 0) - (leftQmon.metrics.totalEstimatedNetEvUsd ?? 0);
    } else if (leftQmon.metrics.totalPnl !== rightQmon.metrics.totalPnl) {
      comparison = rightQmon.metrics.totalPnl - leftQmon.metrics.totalPnl;
    } else {
      comparison = leftQmon.id.localeCompare(rightQmon.id);
    }

    return comparison;
  }

  private compareHistoricalWeakness(leftQmon: Qmon, rightQmon: Qmon): number {
    let comparison = 0;

    if (leftQmon.metrics.fitnessScore !== rightQmon.metrics.fitnessScore) {
      comparison = (leftQmon.metrics.fitnessScore ?? Number.NEGATIVE_INFINITY) - (rightQmon.metrics.fitnessScore ?? Number.NEGATIVE_INFINITY);
    } else if ((leftQmon.metrics.totalEstimatedNetEvUsd ?? 0) !== (rightQmon.metrics.totalEstimatedNetEvUsd ?? 0)) {
      comparison = (leftQmon.metrics.totalEstimatedNetEvUsd ?? 0) - (rightQmon.metrics.totalEstimatedNetEvUsd ?? 0);
    } else if ((leftQmon.metrics.feeRatio ?? 0) !== (rightQmon.metrics.feeRatio ?? 0)) {
      comparison = (rightQmon.metrics.feeRatio ?? 0) - (leftQmon.metrics.feeRatio ?? 0);
    } else if (leftQmon.metrics.totalPnl !== rightQmon.metrics.totalPnl) {
      comparison = leftQmon.metrics.totalPnl - rightQmon.metrics.totalPnl;
    } else {
      comparison = leftQmon.id.localeCompare(rightQmon.id);
    }

    return comparison;
  }

  private isParentEligible(qmon: Qmon): boolean {
    let isEligible = (qmon.strategyKind ?? "genetic") === "genetic" && qmon.lifecycle === "active";

    if (isEligible) {
      isEligible = qmon.position.action === null && qmon.pendingOrder === null;
    }

    if (isEligible) {
      isEligible = qmon.paperWindowPnls.length >= config.QMON_EVOLUTION_MIN_PARENT_WINDOWS;
    }

    if (isEligible) {
      isEligible = (qmon.metrics.fitnessScore ?? Number.NEGATIVE_INFINITY) > 0 && qmon.metrics.totalTrades >= MIN_PARENT_TRADES;
    }

    return isEligible;
  }

  private isDeathEligible(qmon: Qmon, protectedParentIds: ReadonlySet<QmonId>, activeChampionQmonId: QmonId | null): boolean {
    let isEligible = (qmon.strategyKind ?? "genetic") === "genetic" && qmon.lifecycle === "active";

    if (isEligible) {
      isEligible = qmon.position.action === null && qmon.pendingOrder === null;
    }

    if (isEligible) {
      isEligible = qmon.windowsLived >= config.QMON_EVOLUTION_NEWBORN_PROTECTION_WINDOWS;
    }

    if (isEligible && activeChampionQmonId !== null) {
      isEligible = qmon.id !== activeChampionQmonId;
    }

    if (isEligible) {
      isEligible = !protectedParentIds.has(qmon.id);
    }

    if (isEligible) {
      isEligible =
        (qmon.metrics.fitnessScore ?? 0) < 0 ||
        (qmon.metrics.totalEstimatedNetEvUsd ?? 0) < 0 ||
        (qmon.metrics.feeRatio ?? 0) > 0.75 ||
        (qmon.metrics.regimeBreakdown ?? []).filter((regimeSlice) => regimeSlice.tradeCount > 0 && regimeSlice.totalPnl >= 0).length === 0;
    }

    return isEligible;
  }

  private buildParentPool(qmons: readonly Qmon[]): Qmon[] {
    const eligibleParents = qmons
      .filter((qmon) => this.isParentEligible(qmon))
      .sort((leftQmon, rightQmon) => this.compareReproductiveFitness(leftQmon, rightQmon));
    let parentPoolSize = eligibleParents.length;

    if (eligibleParents.length >= MIN_PARENT_POOL_SIZE) {
      // Top 40% performers + 10% random explorers
      const topCount = Math.max(MIN_PARENT_POOL_SIZE, Math.ceil(eligibleParents.length * PARENT_POOL_RATE));
      const randomCount = Math.ceil(Math.min(eligibleParents.length * RANDOM_EXPLORER_RATE, 5));
      parentPoolSize = Math.min(eligibleParents.length, topCount + randomCount);
    }

    const parentPool = eligibleParents.slice(0, parentPoolSize);

    // Add random explorers if there's room
    if (parentPool.length < eligibleParents.length) {
      const remainingCandidates = eligibleParents.slice(parentPool.length);
      const randomExplorers = remainingCandidates
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(5, eligibleParents.length - parentPool.length));
      parentPool.push(...randomExplorers);
    }

    return parentPool;
  }

  private pickWeightedParent(parentPool: readonly Qmon[], excludedQmonId: QmonId | null): Qmon | null {
    const selectableParents = parentPool.filter((parentQmon) => excludedQmonId === null || parentQmon.id !== excludedQmonId);
    let selectedParent: Qmon | null = null;
    let totalWeight = 0;

    for (let index = 0; index < selectableParents.length; index += 1) {
      totalWeight += selectableParents.length - index;
    }

    if (selectableParents.length > 0 && totalWeight > 0) {
      let remainingWeight = Math.random() * totalWeight;

      for (let index = 0; index < selectableParents.length; index += 1) {
        const parentQmon = selectableParents[index];
        const parentWeight = selectableParents.length - index;
        remainingWeight -= parentWeight;

        if (parentQmon !== undefined && remainingWeight <= 0 && selectedParent === null) {
          selectedParent = parentQmon;
        }
      }
    }

    if (selectedParent === null && selectableParents.length > 0) {
      selectedParent = selectableParents[0] ?? null;
    }

    return selectedParent;
  }

  private createEmptyPosition(): QmonPosition {
    return {
      action: null,
      enteredAt: null,
      entryScore: null,
      entryPrice: null,
      peakReturnPct: null,
      shareCount: null,
      priceToBeat: null,
      marketStartMs: null,
      marketEndMs: null,
      entryTriggers: [],
      entryDirectionRegime: null,
      entryVolatilityRegime: null,
      directionalAlpha: null,
      estimatedEdgeBps: null,
      estimatedNetEvUsd: null,
      predictedSlippageBps: null,
      predictedFillQuality: null,
      signalAgreementCount: null,
      dominantSignalGroup: "none",
    };
  }

  private createEmptyMetrics(timestamp: number): QmonMetrics {
    return {
      totalTrades: 0,
      totalPnl: 0,
      peakTotalPnl: 0,
      championScore: null,
      fitnessScore: null,
      paperWindowMedianPnl: null,
      paperWindowPnlSum: 0,
      paperLongWindowPnlSum: 0,
      negativeWindowRateLast10: 0,
      worstWindowPnlLast10: null,
      recentAvgSlippageBps: 0,
      isChampionEligible: false,
      championEligibilityReasons: [
        "insufficient-windows",
        "non-positive-sum",
        "non-positive-median",
        "non-positive-pnl",
        "low-win-rate",
        "insufficient-trades",
        "non-positive-long-window-sum",
      ],
      totalFeesPaid: 0,
      winRate: 0,
      winCount: 0,
      avgScore: 0,
      maxDrawdown: 0,
      grossAlphaCapture: 0,
      netPnlPerTrade: 0,
      feeRatio: 0,
      slippageRatio: 0,
      noTradeDisciplineScore: 0,
      regimeBreakdown: [],
      triggerBreakdown: [],
      totalEstimatedNetEvUsd: 0,
      lastUpdate: timestamp,
    };
  }

  private createChildQmon(market: MarketKey, parentAQmon: Qmon, parentBQmon: Qmon): Qmon {
    const createdAt = Date.now();
    const nextGeneration = Math.max(parentAQmon.generation, parentBQmon.generation) + 1;

    // ADAPTIVE MUTATION RATE: Calculate diversity and adjust
    const populationDiversity = this.calculateGeneticDiversity([parentAQmon, parentBQmon]);
    const adaptiveMutationRate = this.calculateAdaptiveMutationRate(populationDiversity);

    return {
      id: generateQmonId(),
      market,
      strategyKind: "genetic",
      strategyName: "Genetic Offspring Strategy",
      strategyDescription: `Adaptive genome-born QMON produced from parents ${parentAQmon.id} and ${parentBQmon.id}.`,
      presetStrategyId: null,
      presetFamily: null,
      genome: this.genomeService.createOffspringGenome(parentAQmon.genome, parentBQmon.genome, adaptiveMutationRate),
      role: "candidate",
      lifecycle: "active",
      generation: nextGeneration,
      parentIds: [parentAQmon.id, parentBQmon.id],
      createdAt,
      position: this.createEmptyPosition(),
      pendingOrder: null,
      metrics: this.createEmptyMetrics(createdAt),
      decisionHistory: [],
      windowTradeCount: 0,
      windowsLived: 0,
      paperWindowPnls: [],
      paperWindowSlippageBps: [],
      paperWindowBaselinePnl: null,
      currentWindowStart: null,
      currentWindowSlippageTotalBps: 0,
      currentWindowSlippageFillCount: 0,
      lastCloseTimestamp: null,
    };
  }

  private createExploratoryQmon(market: MarketKey, hydrateNewbornQmon: HydrateNewbornQmon | null, currentWindowStartMs: number | null): Qmon {
    const createdAt = Date.now();

    // Create completely random genome (no parents)
    const randomGenome = this.genomeService.createRandomGenome();

    let exploratoryQmon: Qmon = {
      id: generateQmonId(),
      market,
      strategyKind: "genetic",
      strategyName: "Genetic Explorer Strategy",
      strategyDescription: "Fresh random genome-born QMON injected to explore outside the current parent pool.",
      presetStrategyId: null,
      presetFamily: null,
      genome: randomGenome,
      role: "candidate",
      lifecycle: "active",
      generation: 0, // Exploratory QMONs start at generation 0
      parentIds: [], // No parents
      createdAt,
      position: this.createEmptyPosition(),
      pendingOrder: null,
      metrics: this.createEmptyMetrics(createdAt),
      decisionHistory: [],
      windowTradeCount: 0,
      windowsLived: 0,
      paperWindowPnls: [],
      paperWindowSlippageBps: [],
      paperWindowBaselinePnl: null,
      currentWindowStart: null,
      currentWindowSlippageTotalBps: 0,
      currentWindowSlippageFillCount: 0,
      lastCloseTimestamp: null,
    };

    // Apply hydration if provided
    exploratoryQmon = hydrateNewbornQmon === null ? exploratoryQmon : hydrateNewbornQmon(exploratoryQmon, currentWindowStartMs);

    return exploratoryQmon;
  }

  /**
   * Calculate genetic diversity from parent genomes.
   * Returns 0-1, where 1 = maximum diversity.
   */
  private calculateGeneticDiversity(parents: readonly Qmon[]): number {
    if (parents.length < 2) return 1;

    let totalDiversity = 0;
    let comparisons = 0;

    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const parentA = parents[i];
        const parentB = parents[j];
        if (parentA !== undefined && parentB !== undefined) {
          const diversity = this.computeGenomeDifference(parentA.genome, parentB.genome);
          totalDiversity += diversity;
          comparisons += 1;
        }
      }
    }

    return comparisons > 0 ? totalDiversity / comparisons : 1;
  }

  /**
   * Compute difference between two genomes (0 = identical, 1 = completely different).
   */
  private computeGenomeDifference(genomeA: QmonGenome, genomeB: QmonGenome): number {
    let differences = 0;
    let totalComparisons = 0;

    // Compare signal genes
    const signalsA = new Set(genomeA.predictiveSignalGenes.map((g: { signalId: string; orientation: string; weightTier: number }) => `${g.signalId}-${g.orientation}-${g.weightTier}`));
    const signalsB = new Set(genomeB.predictiveSignalGenes.map((g: { signalId: string; orientation: string; weightTier: number }) => `${g.signalId}-${g.orientation}-${g.weightTier}`));
    const signalUnion = new Set([...signalsA, ...signalsB]);
    signalUnion.forEach((key) => {
      totalComparisons += 1;
      if (!signalsA.has(key) || !signalsB.has(key)) differences += 1;
    });

    // Compare trigger genes
    const triggersA = new Set(genomeA.triggerGenes.filter((t: { isEnabled: boolean }) => t.isEnabled).map((t: { triggerId: string }) => t.triggerId));
    const triggersB = new Set(genomeB.triggerGenes.filter((t: { isEnabled: boolean }) => t.isEnabled).map((t: { triggerId: string }) => t.triggerId));
    const triggerUnion = new Set([...triggersA, ...triggersB]);
    triggerUnion.forEach((key) => {
      totalComparisons += 1;
      if (!triggersA.has(key) || !triggersB.has(key)) differences += 1;
    });

    // Compare thresholds
    if (Math.abs(genomeA.minScoreBuy - genomeB.minScoreBuy) > 0.1) differences += 1;
    if (Math.abs(genomeA.minScoreSell - genomeB.minScoreSell) > 0.1) differences += 1;
    totalComparisons += 2;

    return totalComparisons > 0 ? differences / totalComparisons : 0;
  }

  /**
   * Calculate adaptive mutation rate based on genetic diversity.
   * Returns 5%-15% mutation rate (inverted: low diversity = high mutation).
   */
  private calculateAdaptiveMutationRate(diversity: number): number {
    const MIN_MUTATION_RATE = 0.05;
    const MAX_MUTATION_RATE = 0.15;
    const DIVERSITY_THRESHOLD = 0.3;

    // Low diversity → high mutation (15%)
    // High diversity → low mutation (5%)
    if (diversity < DIVERSITY_THRESHOLD) {
      return MAX_MUTATION_RATE;
    }
    return MIN_MUTATION_RATE + (MAX_MUTATION_RATE - MIN_MUTATION_RATE) * ((diversity - DIVERSITY_THRESHOLD) / (1 - DIVERSITY_THRESHOLD));
  }

  /**
   * @section public:methods
   */

  public evolvePopulation(
    population: QmonPopulation,
    hydrateNewbornQmon: HydrateNewbornQmon | null,
    evolutionWindowCount: number | null = null,
  ): EvolutionResult {
    const activeChampionQmonId = population.activeChampionQmonId;
    const parentPool = this.buildParentPool(population.qmons);
    const protectedParentIds = new Set(parentPool.map((parentQmon) => parentQmon.id));
    const geneticQmonCount = population.qmons.filter((qmon) => (qmon.strategyKind ?? "genetic") === "genetic").length;
    const candidateDeaths = population.qmons
      .filter((qmon) => this.isDeathEligible(qmon, protectedParentIds, activeChampionQmonId))
      .sort((leftQmon, rightQmon) => this.compareHistoricalWeakness(leftQmon, rightQmon));
    const replacementCount = Math.min(candidateDeaths.length, Math.max(1, Math.ceil(geneticQmonCount * config.QMON_EVOLUTION_REPLACEMENT_RATE)));
    const replacements: EvolutionReplacement[] = [];
    const qmonsById = new Map(population.qmons.map((qmon) => [qmon.id, qmon]));
    let highestChildGeneration: number | null = null;

    // Standard evolution: replace weak QMONs with offspring
    for (let index = 0; index < replacementCount; index += 1) {
      const deadQmon = candidateDeaths[index];
      const parentAQmon = this.pickWeightedParent(parentPool, null);
      const parentBQmon = parentAQmon !== null ? this.pickWeightedParent(parentPool, parentAQmon.id) : null;

      if (deadQmon !== undefined && parentAQmon !== null && parentBQmon !== null) {
        let childQmon = this.createChildQmon(population.market, parentAQmon, parentBQmon);
        childQmon = hydrateNewbornQmon === null ? childQmon : hydrateNewbornQmon(childQmon, population.seatLastWindowStartMs);
        qmonsById.delete(deadQmon.id);
        qmonsById.set(childQmon.id, childQmon);
        replacements.push({
          childQmonId: childQmon.id,
          deadQmonId: deadQmon.id,
          parentIds: [parentAQmon.id, parentBQmon.id],
          generation: childQmon.generation,
          replacementCount: index + 1,
        });
        highestChildGeneration = highestChildGeneration === null ? childQmon.generation : Math.max(highestChildGeneration, childQmon.generation);
      }
    }

    // EXPLORATORY INJECTION: Every 50 windows, inject 20 completely random genomes
    // This helps escape local optima and discover strategies outside predefined families
    const shouldInjectExplorers =
      evolutionWindowCount !== null && evolutionWindowCount % EXPLORATORY_INJECTION_WINDOW_INTERVAL === 0;

    if (shouldInjectExplorers) {
      const currentQmons = [...qmonsById.values()].filter((qmon) => (qmon.strategyKind ?? "genetic") === "genetic");
      const sortedByWeakness = [...currentQmons].sort((leftQmon, rightQmon) =>
        this.compareHistoricalWeakness(leftQmon, rightQmon),
      );
      const weakestCount = Math.min(EXPLORATORY_INJECTION_SIZE, sortedByWeakness.length);

      // Replace worst performers with exploratory QMONs
      for (let index = 0; index < weakestCount; index += 1) {
        const weakQmon = sortedByWeakness[index];
        if (weakQmon !== undefined) {
          const exploratoryQmon = this.createExploratoryQmon(
            population.market,
            hydrateNewbornQmon,
            population.seatLastWindowStartMs,
          );
          qmonsById.delete(weakQmon.id);
          qmonsById.set(exploratoryQmon.id, exploratoryQmon);
          replacements.push({
            childQmonId: exploratoryQmon.id,
            deadQmonId: weakQmon.id,
            parentIds: [], // No parents for exploratory QMONs
            generation: exploratoryQmon.generation,
            replacementCount: replacementCount + index + 1,
          });
        }
      }
    }

    return {
      population: {
        ...population,
        qmons: [...qmonsById.values()],
      },
      replacements,
      highestChildGeneration,
    };
  }
}
