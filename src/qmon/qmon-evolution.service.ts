/**
 * @section imports:internals
 */

import config from "../config.ts";
import { generateQmonId } from "./qmon-genome.service.ts";
import type { QmonGenomeService } from "./qmon-genome.service.ts";
import type { MarketKey, Qmon, QmonId, QmonMetrics, QmonPopulation, QmonPosition } from "./qmon.types.ts";

/**
 * @section consts
 */

const MIN_PARENT_TRADES = 8;
const PARENT_POOL_RATE = 0.2;
const MIN_PARENT_POOL_SIZE = 8;

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
    let isEligible = qmon.lifecycle === "active";

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
    let isEligible = qmon.lifecycle === "active";

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
      parentPoolSize = Math.min(eligibleParents.length, Math.max(MIN_PARENT_POOL_SIZE, Math.ceil(eligibleParents.length * PARENT_POOL_RATE)));
    }

    return eligibleParents.slice(0, parentPoolSize);
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

    return {
      id: generateQmonId(),
      market,
      genome: this.genomeService.createOffspringGenome(parentAQmon.genome, parentBQmon.genome, config.QMON_EVOLUTION_MUTATION_RATE),
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

  /**
   * @section public:methods
   */

  public evolvePopulation(population: QmonPopulation, hydrateNewbornQmon: HydrateNewbornQmon | null): EvolutionResult {
    const activeChampionQmonId = population.activeChampionQmonId;
    const parentPool = this.buildParentPool(population.qmons);
    const protectedParentIds = new Set(parentPool.map((parentQmon) => parentQmon.id));
    const candidateDeaths = population.qmons
      .filter((qmon) => this.isDeathEligible(qmon, protectedParentIds, activeChampionQmonId))
      .sort((leftQmon, rightQmon) => this.compareHistoricalWeakness(leftQmon, rightQmon));
    const replacementCount = Math.min(candidateDeaths.length, Math.max(1, Math.ceil(population.qmons.length * config.QMON_EVOLUTION_REPLACEMENT_RATE)));
    const replacements: EvolutionReplacement[] = [];
    const qmonsById = new Map(population.qmons.map((qmon) => [qmon.id, qmon]));
    let highestChildGeneration: number | null = null;

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
