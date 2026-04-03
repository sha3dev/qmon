/**
 * @section imports:internals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";
import { RegimeEngine } from "../regime/regime-engine.service.ts";
import type { DirectionRegime, RegimeResult, VolatilityRegime } from "../regime/regime.types.ts";

import config from "../config.ts";
import type { SignalEngine } from "../signal/signal-engine.service.ts";
import type { StructuredSignalResult } from "../signal/signal.types.ts";
import { TriggerEngine } from "../trigger/trigger-engine.service.ts";
import type { TriggerEvent } from "../trigger/trigger.types.ts";
import { QmonChampionService } from "./qmon-champion.service.ts";
import { QmonEvolutionService } from "./qmon-evolution.service.ts";
import type { QmonFillResult } from "./qmon-execution.service.ts";
import { QmonExecutionService } from "./qmon-execution.service.ts";
import { QmonGenomeService, generateQmonId } from "./qmon-genome.service.ts";
import { QmonHydrationService } from "./qmon-hydration.service.ts";
import { QmonReplayHistoryService } from "./qmon-replay-history.service.ts";
import type { QmonValidationLogService } from "./qmon-validation-log.service.ts";
import type {
  DirectionRegimeValue,
  DominantSignalGroup,
  EvaluationResult,
  GateResult,
  MarketKey,
  PendingOrderAction,
  Qmon,
  QmonDecision,
  QmonExecutionRoute,
  QmonExecutionRuntime,
  QmonFamilyState,
  QmonGenome,
  QmonId,
  QmonMetrics,
  QmonPendingOrder,
  QmonPopulation,
  QmonPosition,
  QmonRealWalkForwardGate,
  QmonSignalId,
  RegimePerformanceSlice,
  TimeSegment,
  TradeabilityAssessment,
  TriggerPerformanceSlice,
  TradingAction,
  VolatilityRegimeValue,
} from "./qmon.types.ts";

/**
 * @section consts
 */

/**
 * Default population size per market.
 */
const _DEFAULT_POPULATION_SIZE = 200;

/**
 * Maximum decision history to keep per QMON.
 */
const MAX_DECISION_HISTORY = 20;

/**
 * Minimum shares allowed by Polymarket for a buy order.
 */
const MIN_POSITION_SHARES = 5;

/**
 * Minimum notional value in USD required for a buy order.
 */
const MIN_POSITION_NOTIONAL_USD = 1;

/**
 * Minimum cooldown between closing and reopening a position (milliseconds).
 * Prevents near-simultaneous close+open trades within the same or adjacent ticks.
 */
const ENTRY_COOLDOWN_MS = 30_000;
const STOP_LOSS_MIN_HOLD_MS = 60_000;
const MAX_EV_POSITION_MULTIPLIER = 1.5;
const TRIGGER_EV_DISCOUNT_USD = 0.02;
const NO_TRIGGER_EV_PREMIUM_USD = 0.03;
const THESIS_INVALIDATION_ALPHA_FLIP = 0.08;
const THESIS_INVALIDATION_MICROSTRUCTURE_FLOOR = 0.25;
const PREDICTIVE_SIGNAL_IDS = ["edge", "distance", "momentum", "velocity", "meanReversion", "crossAssetMomentum"] as const;
const _MICROSTRUCTURE_SIGNAL_IDS = ["imbalance", "microprice", "bookDepth", "spread", "staleness", "tokenPressure"] as const;

type PositionPnlResult = {
  readonly pnl: number;
  readonly fee: number;
  readonly exitFee: number;
  readonly entryFee: number;
  readonly grossPnl: number;
  readonly exitPrice: number | null;
  readonly entryPrice: number;
  readonly shareCount: number;
  readonly exitValue: number;
};

type PendingOrderProcessingResult = {
  readonly qmon: Qmon;
  readonly shouldSkipEvaluation: boolean;
};

type SeatProcessingResult = {
  readonly population: QmonPopulation;
  readonly shouldSkipEvaluation: boolean;
};

type PositionCloseDecision = {
  readonly close: boolean;
  readonly reason: string;
};

type SettledPositionResult = {
  readonly qmon: Qmon;
  readonly positionPnl: PositionPnlResult;
  readonly pnlContribution: number;
};

type WeightedExchangeSignals = {
  readonly oracleLag: number | null;
  readonly dispersion: number | null;
  readonly imbalance: number | null;
  readonly microprice: number | null;
  readonly staleness: number | null;
  readonly spread: number | null;
  readonly bookDepth: number | null;
};

type CompiledSignalBlockGene = {
  readonly signalId: QmonSignalId;
  readonly orientationMultiplier: 1 | -1;
  readonly weight: number;
  readonly signalGroup: "predictive" | "microstructure";
  readonly isHorizonBased: boolean;
};

type DirectionalAlphaResult = {
  readonly directionalAlpha: number;
  readonly predictiveAlpha: number;
  readonly microstructureAlpha: number;
  readonly signalAgreementCount: number;
  readonly dominantSignalGroup: DominantSignalGroup;
};

type CompiledQmonGenome = {
  readonly exchangeWeightSignature: string;
  readonly enabledTriggerIds: readonly string[];
  readonly predictiveBlockWeight: number;
  readonly microstructureBlockWeight: number;
  readonly compiledSignalGenes: readonly CompiledSignalBlockGene[];
};

type EvaluationOptions = {
  readonly shouldBlockEntries: boolean;
  readonly shouldBlockSeatEntries: boolean;
  readonly shouldSkipEvolution: boolean;
  readonly executionMode: "paper" | "real";
};

type QmonEngineStats = {
  readonly totalPopulations: number;
  readonly totalQmons: number;
  readonly totalDecisions: number;
  readonly globalGeneration: number;
  readonly metricsRefreshCount: number;
  readonly marketSignalsCacheHits: number;
  readonly marketSignalsCacheMisses: number;
  readonly averageEvaluateAllDurationMs: number;
  readonly stateSnapshotVersion: number;
};

/**
 * @section class
 */

export class QmonEngine {
  /**
   * @section private:attributes
   */

  private readonly assets: readonly string[];
  private readonly windows: readonly string[];
  private readonly signalEngine: SignalEngine | null;
  private readonly championService: QmonChampionService;
  private readonly genomeService: QmonGenomeService;
  private readonly evolutionService: QmonEvolutionService;
  private readonly executionService: QmonExecutionService;
  private readonly replayHistoryService: QmonReplayHistoryService | null;
  private readonly hydrationService: QmonHydrationService | null;
  private readonly validationLogService: QmonValidationLogService | null;
  private readonly isEvolutionEnabled: boolean;
  private familyState: QmonFamilyState;
  private lastTriggers: TriggerEvent[];
  private snapshots: readonly Snapshot[];
  private hasStateMutation: boolean;
  private hasCriticalMutation: boolean;
  private readonly compiledGenomeCache: WeakMap<QmonGenome, CompiledQmonGenome>;
  private currentWeightedSignalCache: Map<string, WeightedExchangeSignals>;
  private metricsRefreshCount: number;
  private marketSignalsCacheHits: number;
  private marketSignalsCacheMisses: number;
  private evaluateAllDurationTotalMs: number;
  private evaluateAllRunCount: number;
  private stateSnapshotVersion: number;

  /**
   * @section constructor
   */

  public constructor(
    assets: readonly string[],
    windows: readonly string[],
    initialFamilyState?: QmonFamilyState,
    signalEngine?: SignalEngine,
    snapshots?: readonly Snapshot[],
    validationLogService?: QmonValidationLogService,
    isEvolutionEnabled = config.QMON_EVOLUTION_ENABLED,
    shouldEnableHydration = true,
  ) {
    this.assets = assets;
    this.windows = windows;
    this.signalEngine = signalEngine ?? null;
    this.championService = new QmonChampionService();
    this.genomeService = QmonGenomeService.createDefault();
    this.evolutionService = new QmonEvolutionService(this.genomeService);
    this.executionService = new QmonExecutionService();
    this.isEvolutionEnabled = isEvolutionEnabled;
    this.validationLogService = validationLogService ?? null;
    this.snapshots = snapshots ?? [];
    this.lastTriggers = [];
    this.hasStateMutation = false;
    this.hasCriticalMutation = false;
    this.compiledGenomeCache = new WeakMap();
    this.currentWeightedSignalCache = new Map();
    this.metricsRefreshCount = 0;
    this.marketSignalsCacheHits = 0;
    this.marketSignalsCacheMisses = 0;
    this.evaluateAllDurationTotalMs = 0;
    this.evaluateAllRunCount = 0;
    this.stateSnapshotVersion = 0;
    this.replayHistoryService = shouldEnableHydration && this.signalEngine !== null ? new QmonReplayHistoryService() : null;
    this.hydrationService =
      this.replayHistoryService !== null
        ? new QmonHydrationService(this.replayHistoryService, (newbornQmon, snapshotTape, currentWindowStartMs) =>
            this.replayHydratedQmon(newbornQmon, snapshotTape, currentWindowStartMs),
          )
        : null;
    this.familyState = this.createEmptyFamilyState();

    if (initialFamilyState !== undefined) {
      this.setFamilyState(initialFamilyState);
    }
  }

  /**
   * @section factory
   */

  public static createDefault(
    assets: readonly string[],
    windows: readonly string[],
    signalEngine?: SignalEngine,
    validationLogService?: QmonValidationLogService,
  ): QmonEngine {
    return new QmonEngine(assets, windows, undefined, signalEngine, undefined, validationLogService);
  }

  /**
   * @section private:methods
   */

  /**
   * Create an empty family state.
   */
  private createEmptyFamilyState(): QmonFamilyState {
    return {
      populations: [],
      globalGeneration: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Mark the engine state as mutated during the current evaluation tick.
   */
  private markStateMutation(isCriticalMutation: boolean): void {
    this.hasStateMutation = true;
    this.stateSnapshotVersion += 1;

    if (isCriticalMutation) {
      this.hasCriticalMutation = true;
    }
  }

  /**
   * Refresh QMON metrics only when a state transition actually happened.
   */
  private refreshQmonMetrics(qmon: Qmon): Qmon {
    this.metricsRefreshCount += 1;

    return this.championService.refreshMetrics(qmon);
  }

  /**
   * Create the canonical execution runtime block stored per market.
   */
  private createDefaultExecutionRuntime(route: QmonExecutionRoute): QmonExecutionRuntime {
    let executionRuntime: QmonExecutionRuntime = {
      route,
      executionState: "paper",
      pendingIntent: null,
      orderId: null,
      submittedAt: null,
      confirmedVenueSeat: null,
      pendingVenueOrders: [],
      recoveryStartedAt: null,
      lastReconciledAt: null,
      lastError: null,
      isHalted: false,
    };

    if (route === "real") {
      executionRuntime = {
        ...executionRuntime,
        executionState: "real-armed",
      };
    }

    return executionRuntime;
  }

  /**
   * Build the conservative real-routing validation state for the population champion.
   */
  private buildRealWalkForwardGate(population: QmonPopulation): QmonRealWalkForwardGate {
    const championQmon =
      population.activeChampionQmonId === null ? null : (population.qmons.find((qmon) => qmon.id === population.activeChampionQmonId) ?? null);
    const netPnlUsd = championQmon?.metrics.paperLongWindowPnlSum ?? 0;
    const maxDrawdownUsd = championQmon?.metrics.maxDrawdown ?? 0;
    const tradeCount = championQmon?.metrics.totalTrades ?? 0;
    const feeRatio = championQmon?.metrics.feeRatio ?? 1;
    const recentAvgSlippageBps = championQmon?.metrics.recentAvgSlippageBps ?? Number.POSITIVE_INFINITY;
    let rejectReason: string | null = null;

    if (!config.QMON_REAL_REQUIRE_WALK_FORWARD) {
      rejectReason = null;
    } else if (championQmon === null) {
      rejectReason = "no-active-champion";
    } else if (tradeCount < config.QMON_REAL_MIN_WF_TRADES) {
      rejectReason = "walk-forward-insufficient-trades";
    } else if (netPnlUsd < config.QMON_REAL_MIN_WF_NET_PNL_USD) {
      rejectReason = "walk-forward-net-pnl-too-low";
    } else if (maxDrawdownUsd > config.QMON_REAL_MAX_WF_DRAWDOWN_USD) {
      rejectReason = "walk-forward-drawdown-too-high";
    } else if (feeRatio > config.QMON_REAL_MAX_WF_FEE_RATIO) {
      rejectReason = "walk-forward-fee-ratio-too-high";
    } else if (recentAvgSlippageBps > config.QMON_REAL_MAX_WF_SLIPPAGE_BPS) {
      rejectReason = "walk-forward-slippage-too-high";
    } else if ((championQmon.metrics.paperWindowPnlSum ?? 0) <= 0 || (championQmon.metrics.negativeWindowRateLast10 ?? 1) > 0.4) {
      rejectReason = "walk-forward-rolling-deterioration";
    } else if (!(championQmon.metrics.isChampionEligible && (championQmon.metrics.championScore ?? Number.NEGATIVE_INFINITY) > 0)) {
      rejectReason = "champion-not-production-ready";
    }

    return {
      isEnabled: config.QMON_REAL_REQUIRE_WALK_FORWARD,
      isPassed: rejectReason === null,
      championQmonId: championQmon?.id ?? null,
      rejectReason,
      netPnlUsd,
      maxDrawdownUsd,
      tradeCount,
      feeRatio,
      recentAvgSlippageBps,
    };
  }

  /**
   * Keep real routing active only while the market is validated or still has a live exit/recovery risk to unwind.
   */
  private resolvePopulationExecutionRoute(
    population: QmonPopulation,
    routeOverride: QmonExecutionRoute | undefined,
    realWalkForwardGate: QmonRealWalkForwardGate,
  ): QmonExecutionRoute {
    const requestedRoute = routeOverride ?? population.executionRuntime?.route ?? "paper";
    const executionRuntime = population.executionRuntime ?? this.createDefaultExecutionRuntime(requestedRoute);
    const hasExitRisk =
      population.seatPosition.action !== null ||
      population.seatPendingOrder?.kind === "exit" ||
      executionRuntime.pendingIntent?.kind === "exit" ||
      executionRuntime.orderId !== null ||
      executionRuntime.confirmedVenueSeat !== null ||
      executionRuntime.pendingVenueOrders.length > 0 ||
      executionRuntime.isHalted ||
      executionRuntime.lastError !== null;
    let resolvedRoute = requestedRoute;

    if (requestedRoute === "real" && !realWalkForwardGate.isPassed && !hasExitRisk) {
      resolvedRoute = "paper";
    }

    return resolvedRoute;
  }

  /**
   * Derive the public execution state from the canonical runtime block.
   */
  private resolveExecutionRuntimeState(executionRuntime: QmonExecutionRuntime): QmonExecutionRuntime["executionState"] {
    let executionState: QmonExecutionRuntime["executionState"] = "paper";

    if (executionRuntime.route === "real") {
      executionState = "real-armed";

      if (executionRuntime.isHalted) {
        executionState = executionRuntime.recoveryStartedAt !== null ? "real-recovery-required" : "real-halted";
      } else if (executionRuntime.pendingIntent?.kind === "entry") {
        executionState = "real-pending-entry";
      } else if (executionRuntime.pendingIntent?.kind === "exit") {
        executionState = "real-pending-exit";
      } else if (executionRuntime.confirmedVenueSeat !== null) {
        executionState = "real-open";
      } else if (executionRuntime.lastError !== null) {
        executionState = "real-error";
      }
    }

    return executionState;
  }

  /**
   * Keep each population aligned with the canonical execution runtime model.
   */
  private normalizePopulationExecutionRuntime(population: QmonPopulation, routeOverride?: QmonExecutionRoute): QmonPopulation {
    const realWalkForwardGate = this.buildRealWalkForwardGate(population);
    const route = this.resolvePopulationExecutionRoute(population, routeOverride, realWalkForwardGate);
    const currentExecutionRuntime = population.executionRuntime ?? this.createDefaultExecutionRuntime(route);
    const normalizedExecutionRuntime: QmonExecutionRuntime = {
      route,
      executionState: currentExecutionRuntime.executionState,
      pendingIntent: route === "real" ? (population.seatPendingOrder ?? currentExecutionRuntime.pendingIntent) : null,
      orderId: route === "real" ? currentExecutionRuntime.orderId : null,
      submittedAt: route === "real" ? currentExecutionRuntime.submittedAt : null,
      confirmedVenueSeat: route === "real" ? currentExecutionRuntime.confirmedVenueSeat : null,
      pendingVenueOrders: route === "real" ? currentExecutionRuntime.pendingVenueOrders : [],
      recoveryStartedAt: route === "real" ? currentExecutionRuntime.recoveryStartedAt : null,
      lastReconciledAt: route === "real" ? currentExecutionRuntime.lastReconciledAt : null,
      lastError: route === "real" ? currentExecutionRuntime.lastError : null,
      isHalted: route === "real" ? currentExecutionRuntime.isHalted : false,
    };

    return {
      ...population,
      realWalkForwardGate,
      executionRuntime: {
        ...normalizedExecutionRuntime,
        executionState: this.resolveExecutionRuntimeState(normalizedExecutionRuntime),
      },
    };
  }

  /**
   * Reset per-tick mutation tracking and exchange-weight caches.
   */
  private resetEvaluationCaches(): void {
    this.hasStateMutation = false;
    this.hasCriticalMutation = false;
    this.currentWeightedSignalCache = new Map();
  }

  /**
   * Replace one population in family state.
   */
  private replacePopulation(updatedPopulation: QmonPopulation): void {
    const normalizedPopulation = this.normalizePopulationExecutionRuntime(updatedPopulation);
    const nextPopulations = this.familyState.populations.map((population) =>
      population.market === normalizedPopulation.market ? normalizedPopulation : population,
    );

    this.familyState = {
      ...this.familyState,
      populations: nextPopulations,
      lastUpdated: normalizedPopulation.lastUpdated,
    };
  }

  /**
   * Check whether a market routes the seat through real execution.
   */
  private isRealExecutionMarket(population: QmonPopulation, evaluationOptions: EvaluationOptions): boolean {
    let isRealMarket = false;

    if (evaluationOptions.executionMode === "real" && population?.executionRuntime?.route === "real") {
      isRealMarket = true;
    }

    return isRealMarket;
  }

  /**
   * Build a synthetic fill from a confirmed real taker order.
   */
  private createRealFillResult(averagePrice: number, filledShares: number): QmonFillResult {
    return {
      filledShares,
      remainingShares: 0,
      averagePrice,
      bestBid: averagePrice,
      bestAsk: averagePrice,
      consumedLevelsJson: null,
      consumedLevelCount: 0,
      worstPrice: averagePrice,
    };
  }

  /**
   * Compile one genome into hot-path friendly structures.
   */
  private getCompiledGenome(qmon: Qmon): CompiledQmonGenome {
    const cachedCompiledGenome = this.compiledGenomeCache.get(qmon.genome);

    if (cachedCompiledGenome) {
      return cachedCompiledGenome;
    }

    const enabledTriggerIds = qmon.genome.triggerGenes.filter((triggerGene) => triggerGene.isEnabled).map((triggerGene) => triggerGene.triggerId);
    const compiledSignalGenes: CompiledSignalBlockGene[] = [];
    const predictiveSignalGenes = qmon.genome.predictiveSignalGenes ?? [];
    const microstructureSignalGenes = qmon.genome.microstructureSignalGenes ?? [];

    for (const predictiveSignalGene of predictiveSignalGenes) {
      compiledSignalGenes.push({
        signalId: predictiveSignalGene.signalId,
        orientationMultiplier: predictiveSignalGene.orientation === "aligned" ? 1 : -1,
        weight: predictiveSignalGene.weightTier,
        signalGroup: "predictive",
        isHorizonBased:
          predictiveSignalGene.signalId === "momentum" || predictiveSignalGene.signalId === "velocity" || predictiveSignalGene.signalId === "meanReversion",
      });
    }

    for (const microstructureSignalGene of microstructureSignalGenes) {
      compiledSignalGenes.push({
        signalId: microstructureSignalGene.signalId,
        orientationMultiplier: microstructureSignalGene.orientation === "aligned" ? 1 : -1,
        weight: microstructureSignalGene.weightTier,
        signalGroup: "microstructure",
        isHorizonBased: false,
      });
    }

    if (compiledSignalGenes.length === 0) {
      for (const signalGene of qmon.genome.signalGenes) {
        const scalarWeight = signalGene.weights._default;
        const isHorizonBased = signalGene.weights["30s"] !== undefined || signalGene.weights["2m"] !== undefined || signalGene.weights["5m"] !== undefined;
        const rawWeight = typeof scalarWeight === "number" ? scalarWeight : typeof signalGene.weights["30s"] === "number" ? signalGene.weights["30s"] : 0;
        const signalGroup = (PREDICTIVE_SIGNAL_IDS as readonly string[]).includes(signalGene.signalId) ? "predictive" : "microstructure";

        if (rawWeight !== 0) {
          compiledSignalGenes.push({
            signalId: signalGene.signalId as QmonSignalId,
            orientationMultiplier: rawWeight >= 0 ? 1 : -1,
            weight: Math.max(1, Math.min(3, Math.round(Math.abs(rawWeight)))) as 1 | 2 | 3,
            signalGroup,
            isHorizonBased,
          });
        }
      }
    }

    const compiledGenome: CompiledQmonGenome = {
      exchangeWeightSignature: qmon.genome.exchangeWeights.join("|"),
      enabledTriggerIds,
      predictiveBlockWeight: 1,
      microstructureBlockWeight: 1,
      compiledSignalGenes,
    };

    this.compiledGenomeCache.set(qmon.genome, compiledGenome);

    return compiledGenome;
  }

  /**
   * Get all market keys for configured assets and windows.
   */
  private getMarketKeys(): MarketKey[] {
    const keys: MarketKey[] = [];
    for (const asset of this.assets) {
      for (const window of this.windows) {
        keys.push(`${asset}-${window}` as MarketKey);
      }
    }
    return keys;
  }

  /**
   * Create a single QMON instance.
   */
  private createQmon(
    market: MarketKey,
    generation: number,
    genome: ReturnType<QmonGenomeService["generateRandomGenome"]> | ReturnType<QmonGenomeService["generateSeededGenome"]>,
    parentIds: QmonId[] = [],
  ): Qmon {
    const now = Date.now();
    return {
      id: generateQmonId(),
      market,
      genome,
      role: "candidate",
      lifecycle: "active",
      generation,
      parentIds,
      createdAt: now,
      position: this.createEmptyPosition(),
      pendingOrder: null,
      metrics: this.createEmptyMetrics(now),
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
   * Create an empty position.
   */
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

  /**
   * Create empty metrics.
   */
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

  /**
   * Create an empty population-level seat position.
   */
  private createEmptyPopulation(market: MarketKey, qmons: readonly Qmon[]): QmonPopulation {
    const now = Date.now();

    return {
      market,
      qmons,
      createdAt: now,
      lastUpdated: now,
      activeChampionQmonId: null,
      marketPaperSessionPnl: 0,
      marketConsolidatedPnl: 0,
      seatPosition: this.createEmptyPosition(),
      seatPendingOrder: null,
      seatLastCloseTimestamp: null,
      seatLastWindowStartMs: null,
      seatLastSettledWindowStartMs: null,
      realWalkForwardGate: {
        isEnabled: config.QMON_REAL_REQUIRE_WALK_FORWARD,
        isPassed: !config.QMON_REAL_REQUIRE_WALK_FORWARD,
        championQmonId: null,
        rejectReason: config.QMON_REAL_REQUIRE_WALK_FORWARD ? "no-active-champion" : null,
        netPnlUsd: 0,
        maxDrawdownUsd: 0,
        tradeCount: 0,
        feeRatio: 1,
        recentAvgSlippageBps: Number.POSITIVE_INFINITY,
      },
      executionRuntime: this.createDefaultExecutionRuntime("paper"),
    };
  }

  /**
   * Create a single-population family state used for newborn replay hydration.
   */
  private createHydrationFamilyState(newbornQmon: Qmon): QmonFamilyState {
    const hydrationTimestamp = Date.now();
    const hydrationFamilyState: QmonFamilyState = {
      populations: [
        {
          market: newbornQmon.market,
          qmons: [newbornQmon],
          createdAt: hydrationTimestamp,
          lastUpdated: hydrationTimestamp,
          activeChampionQmonId: null,
          marketPaperSessionPnl: 0,
          marketConsolidatedPnl: 0,
          seatPosition: this.createEmptyPosition(),
          seatPendingOrder: null,
          seatLastCloseTimestamp: null,
          seatLastWindowStartMs: null,
          seatLastSettledWindowStartMs: null,
          realWalkForwardGate: {
            isEnabled: config.QMON_REAL_REQUIRE_WALK_FORWARD,
            isPassed: !config.QMON_REAL_REQUIRE_WALK_FORWARD,
            championQmonId: null,
            rejectReason: config.QMON_REAL_REQUIRE_WALK_FORWARD ? "no-active-champion" : null,
            netPnlUsd: 0,
            maxDrawdownUsd: 0,
            tradeCount: 0,
            feeRatio: 1,
            recentAvgSlippageBps: Number.POSITIVE_INFINITY,
          },
          executionRuntime: this.createDefaultExecutionRuntime("paper"),
        },
      ],
      globalGeneration: this.familyState.globalGeneration,
      createdAt: hydrationTimestamp,
      lastUpdated: hydrationTimestamp,
    };

    return hydrationFamilyState;
  }

  /**
   * Normalize a replayed newborn back into a clean live candidate for the current window.
   */
  private normalizeHydratedQmon(replayedQmon: Qmon, currentWindowStartMs: number | null): Qmon {
    const hydratedDecisionHistory = replayedQmon.decisionHistory.map((decision) => ({
      ...decision,
      isHydratedReplay: true,
    }));
    const normalizedHydratedQmon = this.refreshQmonMetrics({
      ...replayedQmon,
      role: "candidate",
      position: this.createEmptyPosition(),
      pendingOrder: null,
      decisionHistory: hydratedDecisionHistory,
      windowTradeCount: 0,
      windowsLived: 0,
      paperWindowBaselinePnl: replayedQmon.metrics.totalPnl,
      currentWindowStart: currentWindowStartMs,
      currentWindowSlippageTotalBps: 0,
      currentWindowSlippageFillCount: 0,
      lastCloseTimestamp: null,
    });

    return normalizedHydratedQmon;
  }

  /**
   * Replay retained market snapshots to hydrate one newborn before it joins the live population.
   */
  private replayHydratedQmon(newbornQmon: Qmon, snapshotTape: readonly Snapshot[], currentWindowStartMs: number | null): Qmon {
    const hasReplayPrerequisites = this.signalEngine !== null && snapshotTape.length > 0;
    let hydratedQmon = newbornQmon;

    if (hasReplayPrerequisites && this.signalEngine !== null) {
      const replayBuffer: Snapshot[] = [];
      const replayEngine = new QmonEngine(
        this.assets,
        this.windows,
        this.createHydrationFamilyState(newbornQmon),
        this.signalEngine,
        [],
        undefined,
        false,
        false,
      );
      const replayTriggerEngine = TriggerEngine.createDefault();
      const replayRegimeEngine = RegimeEngine.createDefault();

      for (let index = 0; index < snapshotTape.length; index += 1) {
        const replaySnapshot = snapshotTape[index];

        if (replaySnapshot !== undefined) {
          replayBuffer.push(replaySnapshot);

          if (replayBuffer.length > 700) {
            replayBuffer.splice(0, replayBuffer.length - 700);
          }

          const structuredSignals = this.signalEngine.calculateStructured(replayBuffer);
          const replayTriggers = replayTriggerEngine.evaluate(structuredSignals);
          const replayRegimes = replayRegimeEngine.evaluate(structuredSignals).states;

          replayEngine.updateTriggers(replayTriggers);
          replayEngine.updateSnapshots(replayBuffer);
          replayEngine.evaluateAll(structuredSignals, replayRegimes, replayBuffer, {
            shouldBlockEntries: index === snapshotTape.length - 1,
            shouldSkipEvolution: true,
          });
        }
      }

      const replayPopulation = replayEngine.getPopulation(newbornQmon.market);
      const replayedQmon = replayPopulation?.qmons[0] ?? null;

      if (replayedQmon !== null) {
        hydratedQmon = this.normalizeHydratedQmon(replayedQmon, currentWindowStartMs);
      }
    }

    return hydratedQmon;
  }

  /**
   * Write a validation warning when engine state looks inconsistent.
   */
  private logValidationWarning(market: MarketKey, warningCode: string, qmonId: QmonId | null, details: string): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logValidationWarning({
        market,
        warningCode,
        qmonId,
        details,
      });
    }
  }

  /**
   * Log leader seat initialization for the current market window.
   */
  private logLeaderSeatInitialized(market: MarketKey, selectedLeaderQmonId: QmonId | null, baselinePnl: number | null, marketStartMs: number | null): void {
    if (this.validationLogService !== null && selectedLeaderQmonId !== null) {
      this.validationLogService.logLeaderSeatInitialized({
        market,
        qmonId: selectedLeaderQmonId,
        baselinePnl,
        marketStartMs,
        isWarmupWindow: true,
      });
    }
  }

  /**
   * Log a finalized leader window for audit purposes.
   */
  private logLeaderWindowFinalized(
    market: MarketKey,
    previousLeaderQmonId: QmonId,
    baselinePnl: number,
    endingTotalPnl: number,
    windowRealizedDelta: number,
    wasWarmupWindow: boolean,
    previousConsolidatedPnl: number,
    previousConsolidatedWindowCount: number,
    nextLeaderQmonId: QmonId | null,
  ): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logLeaderWindowFinalized({
        market,
        qmonId: previousLeaderQmonId,
        baselinePnl,
        endingTotalPnl,
        windowRealizedDelta,
        wasWarmupWindow,
        previousConsolidatedPnl,
        previousConsolidatedWindowCount,
        nextConsolidatedPnl: wasWarmupWindow ? previousConsolidatedPnl : previousConsolidatedPnl + windowRealizedDelta,
        nextConsolidatedWindowCount: wasWarmupWindow ? previousConsolidatedWindowCount : previousConsolidatedWindowCount + 1,
        nextLeaderQmonId,
      });
    }
  }

  /**
   * Log one newborn QMON created by the evolution cycle.
   */
  private logQmonBorn(
    market: MarketKey,
    childQmonId: QmonId,
    parentIds: readonly QmonId[],
    generation: number,
    deadQmonId: QmonId,
    replacementCount: number,
  ): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logQmonBorn({
        market,
        childQmonId,
        parentIds: [...parentIds],
        generation,
        deadQmonId,
        replacementCount,
      });
    }
  }

  /**
   * Log one QMON removed from the live population by the evolution cycle.
   */
  private logQmonDied(
    market: MarketKey,
    deadQmonId: QmonId,
    childQmonId: QmonId,
    parentIds: readonly QmonId[],
    generation: number,
    replacementCount: number,
  ): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logQmonDied({
        market,
        deadQmonId,
        childQmonId,
        parentIds: [...parentIds],
        generation,
        replacementCount,
      });
    }
  }

  /**
   * Log a newly opened paper position.
   */
  private logPositionOpened(
    market: MarketKey,
    qmon: Qmon,
    action: TradingAction,
    entryPrice: number,
    shareCount: number,
    cashflow: number,
    fee: number,
    pnlContribution: number,
    isSeat = false,
  ): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logPositionOpened({
        market,
        qmonId: qmon.id,
        action,
        modelScore: qmon.position.entryScore,
        entryPrice,
        executionPrice: entryPrice,
        shareCount,
        cashflow,
        fee,
        pnlContribution,
        directionalAlpha: qmon.position.directionalAlpha ?? qmon.position.entryScore ?? null,
        estimatedEdgeBps: qmon.position.estimatedEdgeBps ?? null,
        estimatedNetEvUsd: qmon.position.estimatedNetEvUsd ?? null,
        predictedSlippageBps: qmon.position.predictedSlippageBps ?? null,
        signalAgreementCount: qmon.position.signalAgreementCount ?? null,
        dominantSignalGroup: qmon.position.dominantSignalGroup ?? "none",
        priceToBeat: qmon.position.priceToBeat,
        marketStartMs: qmon.position.marketStartMs,
        marketEndMs: qmon.position.marketEndMs,
        windowTradeCount: qmon.windowTradeCount,
        isSeat,
      });
    }

    if (shareCount < MIN_POSITION_SHARES) {
      this.logValidationWarning(market, "position-below-min-shares", qmon.id, `shareCount=${shareCount}`);
    }

    if (entryPrice * shareCount < MIN_POSITION_NOTIONAL_USD) {
      this.logValidationWarning(market, "position-below-min-notional", qmon.id, `notional=${(entryPrice * shareCount).toFixed(6)}`);
    }
  }

  /**
   * Log a closed paper position with the full PnL breakdown.
   */
  private logPositionClosed(qmon: Qmon, market: MarketKey, reason: string, positionPnl: PositionPnlResult, pnlContribution: number, isSeat = false): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logPositionClosed({
        market,
        qmonId: qmon.id,
        action: qmon.position.action,
        reason,
        entryPrice: positionPnl.entryPrice,
        exitPrice: positionPnl.exitPrice,
        shareCount: positionPnl.shareCount,
        grossPnl: positionPnl.grossPnl,
        fee: positionPnl.fee,
        netPnl: positionPnl.pnl,
        cashflow: positionPnl.exitValue - positionPnl.exitFee,
        pnlContribution,
        directionalAlpha: qmon.position.directionalAlpha ?? qmon.position.entryScore ?? null,
        estimatedEdgeBps: qmon.position.estimatedEdgeBps ?? null,
        estimatedNetEvUsd: qmon.position.estimatedNetEvUsd ?? null,
        predictedSlippageBps: qmon.position.predictedSlippageBps ?? null,
        signalAgreementCount: qmon.position.signalAgreementCount ?? null,
        dominantSignalGroup: qmon.position.dominantSignalGroup ?? "none",
        enteredAt: qmon.position.enteredAt,
        marketEndMs: qmon.position.marketEndMs,
        priceToBeat: qmon.position.priceToBeat,
        isSeat,
      });
    }

    if (positionPnl.exitPrice !== null && (positionPnl.exitPrice < 0 || positionPnl.exitPrice > 1)) {
      this.logValidationWarning(market, "invalid-exit-price", qmon.id, `exitPrice=${positionPnl.exitPrice}`);
    }
  }

  /**
   * Log a newly created paper order.
   */
  private logPaperOrderCreated(qmonId: QmonId, pendingOrder: QmonPendingOrder, bestBid: number | null, bestAsk: number | null, isSeat = false): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logPaperOrderCreated({
        market: pendingOrder.market,
        qmonId,
        kind: pendingOrder.kind,
        action: pendingOrder.action,
        limitPrice: pendingOrder.limitPrice,
        requestedShares: pendingOrder.requestedShares,
        remainingShares: pendingOrder.remainingShares,
        bookBestBid: bestBid,
        bookBestAsk: bestAsk,
        isSeat,
      });
    }
  }

  /**
   * Log a paper order confirmation check.
   */
  private logPaperOrderChecked(qmonId: QmonId, pendingOrder: QmonPendingOrder, fillResult: QmonFillResult, isSeat = false): void {
    if (this.validationLogService !== null) {
      const referencePrice = pendingOrder.action === "BUY_UP" || pendingOrder.action === "BUY_DOWN" ? fillResult.bestAsk : fillResult.bestBid;
      const priceImpactBps = this.executionService.calculatePriceImpactBps(referencePrice, fillResult.averagePrice, pendingOrder.action);

      this.validationLogService.logPaperOrderChecked({
        market: pendingOrder.market,
        qmonId,
        kind: pendingOrder.kind,
        action: pendingOrder.action,
        limitPrice: pendingOrder.limitPrice,
        requestedShares: pendingOrder.requestedShares,
        remainingShares: pendingOrder.remainingShares,
        filledShares: fillResult.filledShares,
        vwap: fillResult.averagePrice,
        bookBestBid: fillResult.bestBid,
        bookBestAsk: fillResult.bestAsk,
        consumedLevels: fillResult.consumedLevelsJson,
        consumedLevelCount: fillResult.consumedLevelCount,
        worstPrice: fillResult.worstPrice,
        priceImpactBps,
        isSeat,
      });
    }
  }

  /**
   * Log a successful or partial paper order fill.
   */
  private logPaperOrderFill(qmonId: QmonId, pendingOrder: QmonPendingOrder, fillResult: QmonFillResult, isSeat = false): void {
    if (this.validationLogService !== null) {
      const referencePrice = pendingOrder.action === "BUY_UP" || pendingOrder.action === "BUY_DOWN" ? fillResult.bestAsk : fillResult.bestBid;
      const priceImpactBps = this.executionService.calculatePriceImpactBps(referencePrice, fillResult.averagePrice, pendingOrder.action);
      const payload = {
        market: pendingOrder.market,
        qmonId,
        kind: pendingOrder.kind,
        action: pendingOrder.action,
        limitPrice: pendingOrder.limitPrice,
        requestedShares: pendingOrder.requestedShares,
        filledShares: fillResult.filledShares,
        remainingShares: fillResult.remainingShares,
        vwap: fillResult.averagePrice,
        bookBestBid: fillResult.bestBid,
        bookBestAsk: fillResult.bestAsk,
        consumedLevels: fillResult.consumedLevelsJson,
        consumedLevelCount: fillResult.consumedLevelCount,
        worstPrice: fillResult.worstPrice,
        priceImpactBps,
        isSeat,
      };

      this.validationLogService.logPaperOrderFilled(payload);

      if (fillResult.remainingShares > 0) {
        this.validationLogService.logPaperOrderPartialFill(payload);
      }
    }
  }

  /**
   * Log a paper order expiration.
   */
  private logPaperOrderExpired(qmonId: QmonId, pendingOrder: QmonPendingOrder, reason: string, fillResult?: QmonFillResult, isSeat = false): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logPaperOrderExpired({
        market: pendingOrder.market,
        qmonId,
        kind: pendingOrder.kind,
        action: pendingOrder.action,
        limitPrice: pendingOrder.limitPrice,
        requestedShares: pendingOrder.requestedShares,
        remainingShares: pendingOrder.remainingShares,
        filledShares: fillResult?.filledShares ?? 0,
        vwap: fillResult?.averagePrice ?? null,
        bookBestBid: fillResult?.bestBid ?? null,
        bookBestAsk: fillResult?.bestAsk ?? null,
        reason,
        isSeat,
      });
    }
  }

  /**
   * Get current signal values for a market.
   * Returns both scalar values and horizon-based values for multi-horizon signals.
   * If qmon is provided, applies exchange weights to exchange-based signals.
   */
  private getMarketSignals(
    market: MarketKey,
    signals: StructuredSignalResult,
    qmon?: Qmon,
    snapshots?: readonly Snapshot[],
  ): Record<string, number | null | Record<string, number | null>> {
    const parts = market.split("-");
    const asset = parts[0];
    const window = parts[1];
    if (!asset || !window) return {};

    const assetData = signals[asset];
    if (!assetData) return {};

    const result: Record<string, number | null | Record<string, number | null>> = {};

    // Asset-level signals (including horizon-based)
    for (const [key, value] of Object.entries(assetData.signals)) {
      result[key] = value as number | Record<string, number | null>;
    }

    // Window-level signals (scalar only)
    const windowData = assetData.windows[window];
    if (windowData) {
      for (const [key, value] of Object.entries(windowData.signals)) {
        const val = value as number | null;
        result[key] = val;
      }

      result.upPrice = windowData.prices.upPrice;
      result.downPrice = windowData.prices.downPrice;
    }

    if (asset && window && snapshots !== undefined && snapshots.length > 0) {
      const upBookBestBidAsk = this.executionService.getBookBestBidAsk(this.executionService.getTokenBook(asset, window, "BUY_UP", snapshots));
      const downBookBestBidAsk = this.executionService.getBookBestBidAsk(this.executionService.getTokenBook(asset, window, "BUY_DOWN", snapshots));

      result.upAsk = upBookBestBidAsk?.askPrice ?? this.getScalarSignalValue(result, "upPrice");
      result.downAsk = downBookBestBidAsk?.askPrice ?? this.getScalarSignalValue(result, "downPrice");
    }

    // Apply exchange weights if QMON is provided and SignalEngine is available
    if (qmon && this.signalEngine && snapshots && snapshots.length > 0) {
      const compiledGenome = this.getCompiledGenome(qmon);
      const latestSnapshot = snapshots[snapshots.length - 1];
      const latestSnapshotTimestamp = latestSnapshot && typeof latestSnapshot.generated_at === "number" ? latestSnapshot.generated_at : 0;
      const weightedSignalCacheKey = `${asset}|${compiledGenome.exchangeWeightSignature}|${latestSnapshotTimestamp}`;
      const cachedWeightedSignals = this.currentWeightedSignalCache.get(weightedSignalCacheKey);
      const weightedSignals = cachedWeightedSignals ?? this.signalEngine.calculateExchangeSignalsWithWeights(snapshots, asset, qmon.genome.exchangeWeights);

      if (cachedWeightedSignals === undefined) {
        this.marketSignalsCacheMisses += 1;
        this.currentWeightedSignalCache.set(weightedSignalCacheKey, weightedSignals);
      } else {
        this.marketSignalsCacheHits += 1;
      }

      // Replace exchange-based signals with weighted versions
      result.oracleLag = weightedSignals.oracleLag;
      result.dispersion = weightedSignals.dispersion;
      result.imbalance = weightedSignals.imbalance;
      result.microprice = weightedSignals.microprice;
      result.staleness = weightedSignals.staleness;
      result.spread = weightedSignals.spread;
      result.bookDepth = weightedSignals.bookDepth;
    }

    return result;
  }

  /**
   * Compute time segment from market timing data.
   */
  private computeTimeSegment(marketStartMs: number | null, marketEndMs: number | null): TimeSegment {
    if (marketStartMs === null || marketEndMs === null || marketEndMs <= marketStartMs) {
      return "mid";
    }
    const now = Date.now();
    const total = marketEndMs - marketStartMs;
    const elapsed = now - marketStartMs;
    const progress = elapsed / total;

    if (progress < 0.33) return "early";
    if (progress < 0.67) return "mid";
    return "late";
  }

  /**
   * Check if a trigger gate passes (at least one enabled trigger fired).
   */
  private checkTriggerGate(qmon: Qmon, firedTriggers: readonly string[]): GateResult {
    const compiledGenome = this.getCompiledGenome(qmon);
    const enabledTriggerIds = compiledGenome.enabledTriggerIds;

    // At least one enabled trigger must have fired
    const hasEnabledTrigger = enabledTriggerIds.some((id) => firedTriggers.includes(id));

    if (hasEnabledTrigger) {
      return { passed: true, reason: undefined as string | undefined };
    }
    return {
      passed: false,
      reason: `No enabled trigger fired. Enabled: [${enabledTriggerIds.join(", ")}]`,
    };
  }

  /**
   * Check if time gate passes (current segment is enabled).
   */
  private checkTimeGate(qmon: Qmon, timeSegment: TimeSegment): GateResult {
    const segmentIndex = timeSegment === "early" ? 0 : timeSegment === "mid" ? 1 : 2;
    const enabled = qmon.genome.timeWindowGenes[segmentIndex];

    if (enabled) {
      return { passed: true, reason: undefined as string | undefined };
    }
    return {
      passed: false,
      reason: `Time segment '${timeSegment}' is not enabled`,
    };
  }

  /**
   * Check if regime gate passes (current regimes are enabled).
   */
  private checkRegimeGate(qmon: Qmon, directionRegime: DirectionRegime, volatilityRegime: VolatilityRegime): GateResult {
    const directionIndex = directionRegime === "trending-up" ? 0 : directionRegime === "trending-down" ? 1 : 2;
    const volatilityIndex = volatilityRegime === "high" ? 0 : volatilityRegime === "normal" ? 1 : 2;

    const directionEnabled = qmon.genome.directionRegimeGenes[directionIndex];
    const volatilityEnabled = qmon.genome.volatilityRegimeGenes[volatilityIndex];

    if (!directionEnabled && !volatilityEnabled) {
      return {
        passed: false,
        reason: `Neither direction '${directionRegime}' nor volatility '${volatilityRegime}' are enabled`,
      };
    }
    if (!directionEnabled) {
      return {
        passed: false,
        reason: `Direction regime '${directionRegime}' is not enabled`,
      };
    }
    if (!volatilityEnabled) {
      return {
        passed: false,
        reason: `Volatility regime '${volatilityRegime}' is not enabled`,
      };
    }

    return { passed: true, reason: undefined as string | undefined };
  }

  /**
   * Compute weighted score from signal genes and current signal values.
   * Uses horizon-aware weights for multi-horizon signals.
   *
   * IMPROVED: Now applies confidence weighting to reduce noise from weak signals.
   * Signals near zero (noise) are dampened, while strong signals are amplified.
   */
  private computeScore(qmon: Qmon, signalValues: Record<string, number | null | Record<string, number | null>>): number {
    const score = this.computeDirectionalAlpha(qmon, signalValues).directionalAlpha;

    return score;
  }

  /**
   * Check if threshold gate passes and determine action.
   */
  private checkThresholdGate(qmon: Qmon, score: number): GateResult & { action: TradingAction } {
    if (score >= qmon.genome.minScoreBuy) {
      return { passed: true, action: "BUY_UP", reason: undefined };
    }
    if (score <= -qmon.genome.minScoreSell) {
      return { passed: true, action: "BUY_DOWN", reason: undefined };
    }
    return {
      passed: false,
      action: "HOLD",
      reason: `Score ${score.toFixed(3)} does not exceed threshold (buy: ${qmon.genome.minScoreBuy}, sell: ${qmon.genome.minScoreSell})`,
    };
  }

  /**
   * Update QMON metrics after a decision.
   */
  private updateMetrics(qmon: Qmon, score: number): QmonMetrics {
    const oldMetrics = qmon.metrics;
    const entryCount = qmon.decisionHistory.filter((decision) => decision.action !== "HOLD").length;
    const nextEntryCount = entryCount + 1;
    const totalScore = oldMetrics.avgScore * entryCount + score;
    const newAvgScore = totalScore / nextEntryCount;

    return {
      ...oldMetrics,
      avgScore: newAvgScore,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Add a decision to QMON history, maintaining max size.
   */
  private addDecision(qmon: Qmon, decision: QmonDecision): readonly QmonDecision[] {
    const history = [...qmon.decisionHistory, decision];
    return history.length > MAX_DECISION_HISTORY ? history.slice(-MAX_DECISION_HISTORY) : history;
  }

  /**
   * Update one regime aggregate with a closed trade outcome.
   */
  private updateRegimeBreakdown(
    regimeBreakdown: readonly RegimePerformanceSlice[],
    position: QmonPosition,
    totalTradePnl: number,
  ): readonly RegimePerformanceSlice[] {
    const directionRegime = position.entryDirectionRegime ?? "unknown-direction";
    const volatilityRegime = position.entryVolatilityRegime ?? "unknown-volatility";
    const regime = `regime:${directionRegime}|${volatilityRegime}`;
    const nextRegimeBreakdown = [...regimeBreakdown];
    const regimeIndex = nextRegimeBreakdown.findIndex((regimeSlice) => regimeSlice.regime === regime);
    const currentRegimeSlice = regimeIndex >= 0 ? nextRegimeBreakdown[regimeIndex] : undefined;
    const nextRegimeSlice: RegimePerformanceSlice = {
      regime,
      tradeCount: (currentRegimeSlice?.tradeCount ?? 0) + 1,
      totalPnl: (currentRegimeSlice?.totalPnl ?? 0) + totalTradePnl,
      estimatedNetEvUsd: (currentRegimeSlice?.estimatedNetEvUsd ?? 0) + (position.estimatedNetEvUsd ?? 0),
    };

    if (regimeIndex >= 0) {
      nextRegimeBreakdown[regimeIndex] = nextRegimeSlice;
    } else {
      nextRegimeBreakdown.push(nextRegimeSlice);
    }

    return nextRegimeBreakdown;
  }

  /**
   * Update trigger aggregates from the entry triggers attached to the closed position.
   */
  private updateTriggerBreakdown(
    triggerBreakdown: readonly TriggerPerformanceSlice[],
    position: QmonPosition,
    totalTradePnl: number,
  ): readonly TriggerPerformanceSlice[] {
    const nextTriggerBreakdown = [...triggerBreakdown];
    const entryTriggers = position.entryTriggers ?? [];

    for (const triggerId of entryTriggers) {
      if (!triggerId.startsWith("regime:")) {
        const triggerIndex = nextTriggerBreakdown.findIndex((triggerSlice) => triggerSlice.triggerId === triggerId);
        const currentTriggerSlice = triggerIndex >= 0 ? nextTriggerBreakdown[triggerIndex] : undefined;
        const nextTriggerSlice: TriggerPerformanceSlice = {
          triggerId,
          tradeCount: (currentTriggerSlice?.tradeCount ?? 0) + 1,
          totalPnl: (currentTriggerSlice?.totalPnl ?? 0) + totalTradePnl,
          estimatedNetEvUsd: (currentTriggerSlice?.estimatedNetEvUsd ?? 0) + (position.estimatedNetEvUsd ?? 0),
        };

        if (triggerIndex >= 0) {
          nextTriggerBreakdown[triggerIndex] = nextTriggerSlice;
        } else {
          nextTriggerBreakdown.push(nextTriggerSlice);
        }
      }
    }

    return nextTriggerBreakdown;
  }

  /**
   * Update persistent quality/risk accumulators from one closed trade.
   */
  private updateClosedTradeMetrics(currentMetrics: QmonMetrics, position: QmonPosition, totalTradePnl: number, nextTotalPnl: number): QmonMetrics {
    const previousPeakTotalPnl =
      currentMetrics.peakTotalPnl ?? Math.max(currentMetrics.totalPnl + currentMetrics.maxDrawdown, currentMetrics.totalPnl, 0);
    const nextPeakTotalPnl = Math.max(previousPeakTotalPnl, nextTotalPnl);
    const nextDrawdown = Math.max(currentMetrics.maxDrawdown, nextPeakTotalPnl - nextTotalPnl);
    const nextRegimeBreakdown = this.updateRegimeBreakdown(currentMetrics.regimeBreakdown ?? [], position, totalTradePnl);
    const nextTriggerBreakdown = this.updateTriggerBreakdown(currentMetrics.triggerBreakdown ?? [], position, totalTradePnl);
    const nextMetrics: QmonMetrics = {
      ...currentMetrics,
      peakTotalPnl: nextPeakTotalPnl,
      maxDrawdown: nextDrawdown,
      regimeBreakdown: nextRegimeBreakdown,
      triggerBreakdown: nextTriggerBreakdown,
    };

    return nextMetrics;
  }

  /**
   * Detect whether the cash outflow of the current open position was already booked.
   */
  private hasBookedCurrentEntryCashflow(qmon: Qmon): boolean {
    const enteredAt = qmon.position.enteredAt;
    const action = qmon.position.action;
    let hasBooked = false;

    if (enteredAt !== null && action !== null) {
      hasBooked = qmon.decisionHistory.some((decision) => decision.timestamp === enteredAt && decision.action === action);
    }

    return hasBooked;
  }

  /**
   * Filter the fired triggers down to the ones enabled by one QMON genome.
   */
  private getTriggeredBy(qmon: Qmon, firedTriggerIds: readonly string[]): readonly string[] {
    const compiledGenome = this.getCompiledGenome(qmon);
    const triggeredBy = firedTriggerIds.filter((triggerId) => compiledGenome.enabledTriggerIds.includes(triggerId));

    return triggeredBy;
  }

  /**
   * Read one scalar signal value from the flattened market signals.
   */
  private getScalarSignalValue(signalValues: Record<string, number | null | Record<string, number | null>>, signalId: string): number | null {
    const rawSignalValue = signalValues[signalId];
    const scalarSignalValue = typeof rawSignalValue === "number" ? rawSignalValue : null;

    return scalarSignalValue;
  }

  /**
   * Read one normalized signal value, averaging horizons when needed.
   */
  private getNormalizedSignalValue(signalValues: Record<string, number | null | Record<string, number | null>>, signalId: string): number | null {
    const rawSignalValue = signalValues[signalId];
    let normalizedSignalValue: number | null = null;

    if (typeof rawSignalValue === "object" && rawSignalValue !== null) {
      let signalSum = 0;
      let signalCount = 0;

      for (const horizonSignalValue of Object.values(rawSignalValue)) {
        if (typeof horizonSignalValue === "number") {
          signalSum += horizonSignalValue;
          signalCount += 1;
        }
      }

      normalizedSignalValue = signalCount > 0 ? signalSum / signalCount : null;
    } else if (typeof rawSignalValue === "number") {
      normalizedSignalValue = rawSignalValue;
    }

    return normalizedSignalValue;
  }

  /**
   * Compute the directional alpha and identify the dominant evidence block.
   */
  private computeDirectionalAlpha(qmon: Qmon, signalValues: Record<string, number | null | Record<string, number | null>>): DirectionalAlphaResult {
    const compiledGenome = this.getCompiledGenome(qmon);
    let predictiveContribution = 0;
    let predictiveWeightSum = 0;
    let microstructureContribution = 0;
    let microstructureWeightSum = 0;
    let positiveAgreementCount = 0;
    let negativeAgreementCount = 0;

    for (const compiledSignalGene of compiledGenome.compiledSignalGenes) {
      if (compiledSignalGene.signalId === "spread") {
        continue;
      }

      const normalizedSignalValue = this.getNormalizedSignalValue(signalValues, compiledSignalGene.signalId);

      if (normalizedSignalValue !== null) {
        const signedSignalValue = normalizedSignalValue * compiledSignalGene.orientationMultiplier;

        if (signedSignalValue > 0.05) {
          positiveAgreementCount += 1;
        } else if (signedSignalValue < -0.05) {
          negativeAgreementCount += 1;
        }

        if (compiledSignalGene.signalGroup === "predictive") {
          predictiveContribution += signedSignalValue * compiledSignalGene.weight;
          predictiveWeightSum += compiledSignalGene.weight;
        } else {
          microstructureContribution += signedSignalValue * compiledSignalGene.weight;
          microstructureWeightSum += compiledSignalGene.weight;
        }
      }
    }

    const predictiveAlpha = predictiveWeightSum > 0 ? predictiveContribution / predictiveWeightSum : 0;
    const microstructureAlpha = microstructureWeightSum > 0 ? microstructureContribution / microstructureWeightSum : 0;
    const directionalAlpha = Math.max(
      -1,
      Math.min(1, predictiveAlpha * compiledGenome.predictiveBlockWeight + microstructureAlpha * compiledGenome.microstructureBlockWeight),
    );
    const signalAgreementCount = Math.max(positiveAgreementCount, negativeAgreementCount);
    const dominantSignalGroup =
      Math.abs(predictiveAlpha) > Math.abs(microstructureAlpha)
        ? "predictive"
        : Math.abs(microstructureAlpha) > Math.abs(predictiveAlpha)
          ? "microstructure"
          : Math.abs(directionalAlpha) > 0
            ? "mixed"
            : "none";

    return {
      directionalAlpha,
      predictiveAlpha,
      microstructureAlpha,
      signalAgreementCount,
      dominantSignalGroup,
    };
  }

  /**
   * Estimate tradeability including EV, fill quality and rejection reason.
   */
  private assessTradeability(
    qmon: Qmon,
    action: PendingOrderAction,
    directionalAlphaResult: DirectionalAlphaResult,
    signalValues: Record<string, number | null | Record<string, number | null>>,
    firedTriggerIds: readonly string[],
    limitPrice: number | null,
  ): TradeabilityAssessment {
    const spreadSignalValue = this.getScalarSignalValue(signalValues, "spread") ?? 0;
    const bookDepthSignalValue = this.getScalarSignalValue(signalValues, "bookDepth") ?? 0;
    const imbalanceSignalValue = this.getScalarSignalValue(signalValues, "imbalance") ?? 0;
    const directionMultiplier = action === "BUY_UP" ? 1 : -1;
    const adjustedFillQuality = Math.max(0, Math.min(1, 0.5 + bookDepthSignalValue * 0.35 - Math.max(spreadSignalValue, 0) * 0.3));
    const predictedSlippageBps = Math.max(5, 30 + Math.max(spreadSignalValue, 0) * 80 - bookDepthSignalValue * 25);
    const edgeSignalValue = this.getScalarSignalValue(signalValues, "edge") ?? 0;
    const distanceSignalValue = this.getScalarSignalValue(signalValues, "distance") ?? 0;
    const directionalProbEdge = directionalAlphaResult.directionalAlpha * 0.12;
    const marketUpProbability = action === "BUY_UP" ? (limitPrice ?? 0.5) : Math.max(0.01, Math.min(0.99, 1 - (limitPrice ?? 0.5)));
    const targetUpProbability = Math.max(0.01, Math.min(0.99, marketUpProbability + directionalProbEdge));
    const targetOutcomeProbability = action === "BUY_UP" ? targetUpProbability : 1 - targetUpProbability;
    const impliedProbability = limitPrice ?? 0.5;
    const estimatedEdgeBps = (targetOutcomeProbability - impliedProbability) * 10_000;
    const baseShareCount = this.executionService.computeShareCount(limitPrice);
    const grossEvUsd = baseShareCount === null ? 0 : baseShareCount * (targetOutcomeProbability - impliedProbability);
    const estimatedFeeUsd = baseShareCount === null ? 0 : this.executionService.calculateTakerFeeUsd(baseShareCount, limitPrice);
    const slippageCostUsd = baseShareCount === null || limitPrice === null ? 0 : (predictedSlippageBps / 10_000) * baseShareCount * limitPrice;
    const spreadPenaltyUsd = baseShareCount === null || limitPrice === null ? 0 : Math.max(0, spreadSignalValue) * baseShareCount * limitPrice * 0.15;
    const hasRelevantTrigger = firedTriggerIds.some((triggerId) => this.getCompiledGenome(qmon).enabledTriggerIds.includes(triggerId));
    const requiredNetEvUsd = (qmon.genome.entryPolicy?.minNetEvUsd ?? 0.05) + (hasRelevantTrigger ? -TRIGGER_EV_DISCOUNT_USD : NO_TRIGGER_EV_PREMIUM_USD);
    let tradeabilityRejectReason: string | null = null;

    if (estimatedEdgeBps < (qmon.genome.entryPolicy?.minEdgeBps ?? 25)) {
      tradeabilityRejectReason = "edge-too-small";
    } else if (directionMultiplier * edgeSignalValue < -0.05 || directionMultiplier * distanceSignalValue < -0.05) {
      tradeabilityRejectReason = "directional-conflict";
    } else if (grossEvUsd - estimatedFeeUsd - slippageCostUsd - spreadPenaltyUsd < requiredNetEvUsd) {
      tradeabilityRejectReason = "net-ev-too-small";
    } else if (adjustedFillQuality < (qmon.genome.entryPolicy?.minFillQuality ?? 0.45)) {
      tradeabilityRejectReason = "fill-quality-too-low";
    } else if (predictedSlippageBps > (qmon.genome.entryPolicy?.maxSlippageBps ?? qmon.genome.maxSlippageBps)) {
      tradeabilityRejectReason = "predicted-slippage-too-high";
    } else if (Math.abs(spreadSignalValue) * 100 > (qmon.genome.entryPolicy?.maxSpreadPenaltyBps ?? 40)) {
      tradeabilityRejectReason = "spread-penalty-too-high";
    } else if (directionalAlphaResult.signalAgreementCount < (qmon.genome.entryPolicy?.minConfirmations ?? 2)) {
      tradeabilityRejectReason = "insufficient-confirmations";
    } else if (directionMultiplier * imbalanceSignalValue < -THESIS_INVALIDATION_MICROSTRUCTURE_FLOOR) {
      tradeabilityRejectReason = "book-opposes-direction";
    }

    return {
      directionalAlpha: directionalAlphaResult.directionalAlpha,
      estimatedEdgeBps,
      estimatedNetEvUsd: grossEvUsd - estimatedFeeUsd - slippageCostUsd - spreadPenaltyUsd,
      predictedSlippageBps,
      predictedFillQuality: adjustedFillQuality,
      signalAgreementCount: directionalAlphaResult.signalAgreementCount,
      dominantSignalGroup: directionalAlphaResult.dominantSignalGroup,
      tradeabilityRejectReason,
      shouldAllowEntry: tradeabilityRejectReason === null,
    };
  }

  /**
   * Compute size from EV quality rather than score alone.
   */
  private computePositionSizeFromEv(qmon: Qmon, tokenPrice: number | null, tradeabilityAssessment: TradeabilityAssessment): number | null {
    const baseShareCount = this.executionService.computeShareCount(tokenPrice);
    let sizedShareCount: number | null = null;

    if (baseShareCount !== null) {
      const executionPolicy = qmon.genome.executionPolicy;
      const evMultiplier = tradeabilityAssessment.estimatedNetEvUsd >= 0.12 ? 1.75 : tradeabilityAssessment.estimatedNetEvUsd >= 0.08 ? 1.4 : 1;
      const fillQualityMultiplier = tradeabilityAssessment.predictedFillQuality >= 0.7 ? 1.2 : 1;
      const sizeTierMultiplier = executionPolicy?.sizeTier === 3 ? 1.4 : executionPolicy?.sizeTier === 2 ? 1.15 : 1;
      const rawMultiplier = Math.min(MAX_EV_POSITION_MULTIPLIER, evMultiplier * fillQualityMultiplier * sizeTierMultiplier);
      sizedShareCount = config.QMON_USE_MINIMUM_ENTRY_SHARES ? baseShareCount : Math.ceil(baseShareCount * rawMultiplier);
    }

    return sizedShareCount;
  }

  /**
   * Determine entry action and tradeability from directional alpha.
   */
  private buildEntryDecision(
    qmon: Qmon,
    signalValues: Record<string, number | null | Record<string, number | null>>,
    firedTriggerIds: readonly string[],
    limitPrice: number | null,
  ): { action: TradingAction; tradeabilityAssessment: TradeabilityAssessment } {
    const directionalAlphaResult = this.computeDirectionalAlpha(qmon, signalValues);
    const action: TradingAction =
      directionalAlphaResult.directionalAlpha >= (qmon.genome.minScoreBuy ?? 0.25)
        ? "BUY_UP"
        : directionalAlphaResult.directionalAlpha <= -(qmon.genome.minScoreSell ?? 0.25)
          ? "BUY_DOWN"
          : "HOLD";
    const tradeabilityAssessment =
      action === "HOLD"
        ? {
            directionalAlpha: directionalAlphaResult.directionalAlpha,
            estimatedEdgeBps: 0,
            estimatedNetEvUsd: 0,
            predictedSlippageBps: 0,
            predictedFillQuality: 0,
            signalAgreementCount: directionalAlphaResult.signalAgreementCount,
            dominantSignalGroup: directionalAlphaResult.dominantSignalGroup,
            tradeabilityRejectReason: "alpha-below-threshold",
            shouldAllowEntry: false,
          }
        : this.assessTradeability(qmon, action, directionalAlphaResult, signalValues, firedTriggerIds, limitPrice);

    return {
      action,
      tradeabilityAssessment,
    };
  }

  /**
   * Resolve the executable token price for the selected action from current market prices.
   */
  private getLimitPriceForAction(signalValues: Record<string, number | null | Record<string, number | null>>, action: TradingAction): number | null {
    let limitPrice: number | null = null;

    if (action === "BUY_UP") {
      limitPrice = this.getScalarSignalValue(signalValues, "upAsk") ?? this.getScalarSignalValue(signalValues, "upPrice");
    } else if (action === "BUY_DOWN") {
      limitPrice = this.getScalarSignalValue(signalValues, "downAsk") ?? this.getScalarSignalValue(signalValues, "downPrice");
    }

    return limitPrice;
  }

  /**
   * Track the best unrealized return seen so far for an open position.
   */
  private syncOpenPositionPeakReturn(qmon: Qmon, upPrice: number | null, downPrice: number | null): Qmon {
    const openPositionReturnPct = this.getOpenPositionReturnPct(qmon, upPrice, downPrice);
    const currentPeakReturnPct = qmon.position.peakReturnPct ?? 0;
    const nextPeakReturnPct = openPositionReturnPct !== null ? Math.max(currentPeakReturnPct, openPositionReturnPct) : currentPeakReturnPct;
    let updatedQmon = qmon;

    if (nextPeakReturnPct !== currentPeakReturnPct) {
      updatedQmon = {
        ...qmon,
        position: {
          ...qmon.position,
          peakReturnPct: nextPeakReturnPct,
        },
      };
      this.markStateMutation(false);
    }

    return updatedQmon;
  }

  /**
   * Determine whether the current score has already flipped against the open position.
   */
  private hasOppositeScoreExit(qmon: Qmon, currentScore: number): boolean {
    let hasOppositeExit = false;

    if (qmon.position.action === "BUY_UP") {
      hasOppositeExit = currentScore <= -qmon.genome.minScoreSell;
    } else if (qmon.position.action === "BUY_DOWN") {
      hasOppositeExit = currentScore >= qmon.genome.minScoreBuy;
    }

    return hasOppositeExit;
  }

  /**
   * Stop loss only becomes available after the position has had time to work.
   */
  private hasStopLossAgeBuffer(qmon: Qmon, now: number): boolean {
    const enteredAt = qmon.position.enteredAt;
    let hasBuffer = false;

    if (enteredAt !== null) {
      hasBuffer = now - enteredAt >= STOP_LOSS_MIN_HOLD_MS;
    }

    return hasBuffer;
  }

  /**
   * Queue an exit order and immediately process it when it is taker.
   */
  private queueExitOrder(
    qmon: Qmon,
    asset: string,
    window: string,
    market: MarketKey,
    timestamp: number,
    reason: string,
    score: number,
    results: EvaluationResult[],
    snapshots?: readonly Snapshot[],
    isSeat = false,
    shouldProcessImmediately = true,
  ): Qmon {
    const exitAction = this.getExitAction(qmon.position);
    const tokenBook = exitAction !== null ? this.executionService.getTokenBook(asset, window, exitAction, snapshots ?? this.snapshots) : null;
    const bestBidAsk = this.executionService.getBookBestBidAsk(tokenBook);
    const limitPrice = bestBidAsk?.bidPrice ?? null;
    const requestedShares = qmon.position.shareCount ?? 0;
    let updatedQmon = qmon;

    if (exitAction !== null && limitPrice !== null && requestedShares > 0) {
      const pendingExitOrder = this.executionService.createPendingOrder(
        "exit",
        exitAction,
        score,
        [reason],
        requestedShares,
        limitPrice,
        market,
        qmon.position.marketStartMs,
        qmon.position.marketEndMs,
        qmon.position.priceToBeat,
        timestamp,
      );

      this.logPaperOrderCreated(qmon.id, pendingExitOrder, bestBidAsk?.bidPrice ?? null, bestBidAsk?.askPrice ?? null, isSeat);
      updatedQmon = {
        ...qmon,
        pendingOrder: pendingExitOrder,
      };
      this.markStateMutation(true);

      if (shouldProcessImmediately) {
        updatedQmon = this.processPendingOrder(updatedQmon, asset, window, timestamp, market, results, snapshots, isSeat).qmon;
      }
    }

    return updatedQmon;
  }

  /**
   * Queue an entry order and immediately process it when it is taker.
   */
  private queueEntryOrder(
    qmon: Qmon,
    action: PendingOrderAction,
    score: number,
    tradeabilityAssessment: TradeabilityAssessment,
    triggeredBy: readonly string[],
    directionRegime: DirectionRegimeValue,
    volatilityRegime: VolatilityRegimeValue,
    asset: string,
    window: string,
    market: MarketKey,
    priceToBeat: number | null,
    marketStartMs: number | null,
    marketEndMs: number | null,
    timestamp: number,
    results: EvaluationResult[],
    snapshots?: readonly Snapshot[],
    isSeat = false,
    shouldProcessImmediately = true,
  ): Qmon {
    const tokenBook = this.executionService.getTokenBook(asset, window, action, snapshots ?? this.snapshots);
    const bestBidAsk = this.executionService.getBookBestBidAsk(tokenBook);
    const limitPrice = bestBidAsk?.askPrice ?? null;

    const shareCount = this.computePositionSizeFromEv(qmon, limitPrice, tradeabilityAssessment);

    let updatedQmon = qmon;

    if (limitPrice !== null && shareCount !== null && priceToBeat !== null && marketEndMs !== null) {
      const pendingEntryOrder = this.executionService.createPendingOrder(
        "entry",
        action,
        score,
        triggeredBy,
        shareCount,
        limitPrice,
        market,
        marketStartMs,
        marketEndMs,
        priceToBeat,
        timestamp,
        tradeabilityAssessment,
        directionRegime,
        volatilityRegime,
      );

      this.logPaperOrderCreated(qmon.id, pendingEntryOrder, bestBidAsk?.bidPrice ?? null, bestBidAsk?.askPrice ?? null, isSeat);
      updatedQmon = {
        ...qmon,
        pendingOrder: pendingEntryOrder,
      };
      this.markStateMutation(true);

      if (shouldProcessImmediately) {
        updatedQmon = this.processPendingOrder(updatedQmon, asset, window, timestamp, market, results, snapshots, isSeat).qmon;
      }
    }

    return updatedQmon;
  }

  /**
   * Settle an open position to its binary market outcome.
   */
  private settleOpenPosition(
    qmon: Qmon,
    market: MarketKey,
    asset: string,
    window: string,
    upPrice: number | null,
    downPrice: number | null,
    chainlinkPrice: number | null,
    snapshots?: readonly Snapshot[],
  ): SettledPositionResult {
    const positionPnl = this.calculatePositionPnl(qmon, asset, window, upPrice, downPrice, chainlinkPrice, true, snapshots);
    const closedQmon = this.closePosition(qmon, positionPnl.exitValue, positionPnl.exitFee, "market-settled", market);
    const pnlContribution = positionPnl.exitValue - positionPnl.exitFee;
    const settledPositionResult: SettledPositionResult = {
      qmon: closedQmon,
      positionPnl,
      pnlContribution,
    };

    return settledPositionResult;
  }

  /**
   * Apply a confirmed entry fill to the QMON state.
   */
  private applyEntryFill(qmon: Qmon, pendingOrder: QmonPendingOrder, fillResult: QmonFillResult, now: number): Qmon {
    const executedShareCount = fillResult.filledShares;
    const entryPrice = fillResult.averagePrice ?? 0;
    const shareCount = this.executionService.calculateNetTakerBuyShares(executedShareCount, fillResult.averagePrice);
    const entryCost = shareCount * entryPrice;
    const entryFee = entryPrice > 0 && executedShareCount > 0 ? this.executionService.calculateTakerFeeUsd(executedShareCount, fillResult.averagePrice) : 0;
    const entryCashflow = -(entryCost + entryFee);

    const entryDecision: QmonDecision = {
      timestamp: now,
      market: pendingOrder.market,
      action: pendingOrder.action === "BUY_UP" ? "BUY_UP" : "BUY_DOWN",
      modelScore: pendingOrder.score,
      triggeredBy: pendingOrder.triggeredBy,
      cashflow: entryCashflow,
      fee: entryFee,
      executionPrice: fillResult.averagePrice,
      entryPrice: fillResult.averagePrice,
      shareCount,
      priceImpactBps: this.executionService.calculatePriceImpactBps(fillResult.bestAsk, fillResult.averagePrice, pendingOrder.action),
      isHydratedReplay: false,
      entryDirectionRegime: pendingOrder.entryDirectionRegime ?? null,
      entryVolatilityRegime: pendingOrder.entryVolatilityRegime ?? null,
      directionalAlpha: pendingOrder.directionalAlpha ?? pendingOrder.score,
      estimatedEdgeBps: pendingOrder.estimatedEdgeBps ?? null,
      estimatedNetEvUsd: pendingOrder.estimatedNetEvUsd ?? null,
      predictedSlippageBps: pendingOrder.predictedSlippageBps ?? null,
      tradeabilityRejectReason: pendingOrder.tradeabilityRejectReason ?? null,
      signalAgreementCount: pendingOrder.signalAgreementCount ?? null,
      dominantSignalGroup: pendingOrder.dominantSignalGroup ?? "none",
    };
    const updatedMetrics = this.updateMetrics(qmon, pendingOrder.score);

    let updatedQmon: Qmon = {
      ...qmon,
      pendingOrder: null,
      metrics: {
        ...updatedMetrics,
        totalPnl: updatedMetrics.totalPnl + entryCashflow,
        totalFeesPaid: updatedMetrics.totalFeesPaid + entryFee,
        totalEstimatedNetEvUsd: (updatedMetrics.totalEstimatedNetEvUsd ?? 0) + (pendingOrder.estimatedNetEvUsd ?? 0),
        grossAlphaCapture: (updatedMetrics.grossAlphaCapture ?? 0) + Math.max(pendingOrder.estimatedNetEvUsd ?? 0, 0),
      },
      decisionHistory: this.addDecision(qmon, entryDecision),
      position: {
        action: pendingOrder.action === "BUY_UP" ? "BUY_UP" : "BUY_DOWN",
        enteredAt: now,
        entryScore: pendingOrder.score,
        entryPrice: fillResult.averagePrice,
        peakReturnPct: 0,
        shareCount,
        priceToBeat: pendingOrder.priceToBeat,
        marketStartMs: pendingOrder.marketStartMs,
        marketEndMs: pendingOrder.marketEndMs,
        entryTriggers: pendingOrder.triggeredBy,
        entryDirectionRegime: pendingOrder.entryDirectionRegime ?? null,
        entryVolatilityRegime: pendingOrder.entryVolatilityRegime ?? null,
        directionalAlpha: pendingOrder.directionalAlpha ?? pendingOrder.score,
        estimatedEdgeBps: pendingOrder.estimatedEdgeBps ?? null,
        estimatedNetEvUsd: pendingOrder.estimatedNetEvUsd ?? null,
        predictedSlippageBps: pendingOrder.predictedSlippageBps ?? null,
        predictedFillQuality: pendingOrder.predictedFillQuality ?? null,
        signalAgreementCount: pendingOrder.signalAgreementCount ?? null,
        dominantSignalGroup: pendingOrder.dominantSignalGroup ?? "none",
      },
      currentWindowSlippageTotalBps: qmon.currentWindowSlippageTotalBps + (entryDecision.priceImpactBps ?? 0),
      currentWindowSlippageFillCount: qmon.currentWindowSlippageFillCount + 1,
    };

    updatedQmon = this.incrementTradeCount(updatedQmon);
    updatedQmon = this.refreshQmonMetrics(updatedQmon);
    this.markStateMutation(true);

    return updatedQmon;
  }

  /**
   * Apply a confirmed exit fill to the QMON state.
   */
  private applyExitFill(qmon: Qmon, pendingOrder: QmonPendingOrder, fillResult: QmonFillResult, reason: string, now: number): Qmon {
    const existingShareCount = qmon.position.shareCount ?? 0;
    const exitPrice = fillResult.averagePrice ?? 0;
    const entryPrice = qmon.position.entryPrice ?? 0;
    const entryFee =
      entryPrice > 0 && fillResult.filledShares > 0 ? this.executionService.calculateHeldEntryTakerFeeUsd(fillResult.filledShares, entryPrice) : 0;
    const exitFee =
      exitPrice > 0 && fillResult.filledShares > 0 ? this.executionService.calculateTakerFeeUsd(fillResult.filledShares, fillResult.averagePrice) : 0;
    const exitValue = fillResult.filledShares * exitPrice;
    const entryCost = fillResult.filledShares * entryPrice;
    const totalTradeFee = entryFee + exitFee;
    const totalTradePnl = exitValue - entryCost - totalTradeFee;
    const exitCashflow = exitValue - exitFee;
    const hasBookedEntryCashflow = this.hasBookedCurrentEntryCashflow(qmon);
    const pnlDelta = hasBookedEntryCashflow ? exitCashflow : totalTradePnl;

    const remainingPositionShares = existingShareCount - fillResult.filledShares;
    const exitDecision: QmonDecision = {
      timestamp: now,
      market: pendingOrder.market,
      action: "HOLD",
      modelScore: qmon.position.entryScore,
      triggeredBy: [reason],
      cashflow: exitCashflow,
      fee: exitFee,
      executionPrice: fillResult.averagePrice,
      entryPrice: qmon.position.entryPrice ?? null,
      shareCount: fillResult.filledShares,
      priceImpactBps: this.executionService.calculatePriceImpactBps(fillResult.bestBid, fillResult.averagePrice, pendingOrder.action),
      isHydratedReplay: false,
      entryDirectionRegime: qmon.position.entryDirectionRegime ?? null,
      entryVolatilityRegime: qmon.position.entryVolatilityRegime ?? null,
      directionalAlpha: qmon.position.directionalAlpha ?? qmon.position.entryScore,
      estimatedEdgeBps: qmon.position.estimatedEdgeBps ?? null,
      estimatedNetEvUsd: qmon.position.estimatedNetEvUsd ?? null,
      predictedSlippageBps: qmon.position.predictedSlippageBps ?? null,
      tradeabilityRejectReason: null,
      signalAgreementCount: qmon.position.signalAgreementCount ?? null,
      dominantSignalGroup: qmon.position.dominantSignalGroup ?? "none",
    };
    const currentMetrics = qmon.metrics;
    const newTotalTrades = currentMetrics.totalTrades + 1;
    const newTotalPnl = currentMetrics.totalPnl + pnlDelta;
    const newTotalFees = currentMetrics.totalFeesPaid + exitFee;
    const newWinCount = currentMetrics.winCount + (totalTradePnl > 0 ? 1 : 0);
    const newWinRate = newTotalTrades > 0 ? newWinCount / newTotalTrades : 0;
    const nextMetrics = this.updateClosedTradeMetrics(
      {
        ...currentMetrics,
        totalTrades: newTotalTrades,
        totalPnl: newTotalPnl,
        totalFeesPaid: newTotalFees,
        winRate: newWinRate,
        winCount: newWinCount,
        lastUpdate: now,
      },
      qmon.position,
      totalTradePnl,
      newTotalPnl,
    );
    const nextPosition =
      remainingPositionShares > 0
        ? {
            ...qmon.position,
            shareCount: remainingPositionShares,
          }
        : this.createEmptyPosition();

    this.markStateMutation(true);

    return this.refreshQmonMetrics({
      ...qmon,
      pendingOrder: null,
      position: nextPosition,
      metrics: nextMetrics,
      decisionHistory: this.addDecision(qmon, exitDecision),
      currentWindowSlippageTotalBps: qmon.currentWindowSlippageTotalBps + (exitDecision.priceImpactBps ?? 0),
      currentWindowSlippageFillCount: qmon.currentWindowSlippageFillCount + 1,
      lastCloseTimestamp: remainingPositionShares > 0 ? qmon.lastCloseTimestamp : now,
    });
  }

  /**
   * Process one pending paper order.
   */
  private processPendingOrder(
    qmon: Qmon,
    asset: string,
    window: string,
    now: number,
    market: MarketKey,
    results: EvaluationResult[],
    snapshots?: readonly Snapshot[],
    isSeat = false,
  ): PendingOrderProcessingResult {
    const pendingOrder = qmon.pendingOrder;
    let updatedQmon = qmon;
    let shouldSkipEvaluation = false;

    if (pendingOrder === null) {
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    if (this.executionService.hasPendingOrderExpiredAtMarketEnd(pendingOrder, now)) {
      this.logPaperOrderExpired(qmon.id, pendingOrder, "market-ended", undefined, isSeat);
      updatedQmon = {
        ...qmon,
        pendingOrder: null,
      };
      this.markStateMutation(true);
      shouldSkipEvaluation = pendingOrder.kind === "entry";
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    if (!this.executionService.canCheckPendingOrder()) {
      shouldSkipEvaluation = true;
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    const tokenBook = this.executionService.getTokenBook(asset, window, pendingOrder.action, snapshots ?? this.snapshots);
    const fillResult = this.executionService.simulateFill(tokenBook, pendingOrder);

    this.logPaperOrderChecked(qmon.id, pendingOrder, fillResult, isSeat);

    if (!this.executionService.hasPendingOrderReachedCheckTime(pendingOrder, fillResult, now)) {
      shouldSkipEvaluation = true;
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    if (fillResult.filledShares <= 0 || fillResult.averagePrice === null) {
      if (this.executionService.hasPendingOrderTimedOut(pendingOrder, fillResult, now)) {
        this.logPaperOrderExpired(qmon.id, pendingOrder, "not-filled", fillResult, isSeat);
        updatedQmon = {
          ...qmon,
          pendingOrder: null,
        };
        this.markStateMutation(true);
      }
      shouldSkipEvaluation = true;
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    if (this.executionService.shouldRequireFullFill(pendingOrder) && fillResult.remainingShares > 0) {
      if (this.executionService.hasPendingOrderTimedOut(pendingOrder, fillResult, now)) {
        this.logPaperOrderExpired(qmon.id, pendingOrder, "not-fully-filled", fillResult, isSeat);
        updatedQmon = {
          ...qmon,
          pendingOrder: null,
        };
        this.markStateMutation(true);
      }
      shouldSkipEvaluation = true;
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    if (pendingOrder.kind === "entry" && !this.executionService.isEntryFillValid(fillResult)) {
      this.logPaperOrderExpired(qmon.id, pendingOrder, "below-min-fill", fillResult, isSeat);
      this.logValidationWarning(
        market,
        "entry-fill-below-minimum",
        qmon.id,
        `filledShares=${fillResult.filledShares.toFixed(4)} averagePrice=${(fillResult.averagePrice ?? 0).toFixed(6)}`,
      );
      updatedQmon = {
        ...qmon,
        pendingOrder: null,
      };
      this.markStateMutation(true);
      shouldSkipEvaluation = true;
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    const rejectedSlippageBps = this.executionService.shouldRejectFillForSlippage(qmon.genome.maxSlippageBps, pendingOrder, fillResult);

    if (rejectedSlippageBps !== null) {
      this.logPaperOrderExpired(qmon.id, pendingOrder, "slippage-rejected", fillResult, isSeat);
      this.logValidationWarning(
        market,
        "slippage-rejected",
        qmon.id,
        `priceImpactBps=${rejectedSlippageBps.toFixed(2)} maxSlippageBps=${qmon.genome.maxSlippageBps}`,
      );
      updatedQmon = {
        ...qmon,
        pendingOrder: null,
      };
      this.markStateMutation(true);
      shouldSkipEvaluation = true;
      return { qmon: updatedQmon, shouldSkipEvaluation };
    }

    this.logPaperOrderFill(qmon.id, pendingOrder, fillResult, isSeat);

    if (pendingOrder.kind === "entry") {
      updatedQmon = this.applyEntryFill(qmon, pendingOrder, fillResult, now);
      const entryShareCount = updatedQmon.position.shareCount ?? fillResult.filledShares;
      const entryFee =
        (fillResult.averagePrice ?? 0) > 0 && fillResult.filledShares > 0
          ? this.executionService.calculateTakerFeeUsd(fillResult.filledShares, fillResult.averagePrice)
          : 0;
      const entryCashflow = -(entryShareCount * (fillResult.averagePrice ?? 0) + entryFee);
      this.logPositionOpened(
        market,
        updatedQmon,
        updatedQmon.position.action ?? "HOLD",
        fillResult.averagePrice ?? 0,
        entryShareCount,
        entryCashflow,
        entryFee,
        entryCashflow,
        isSeat,
      );
      results.push({
        qmonId: qmon.id,
        action: updatedQmon.position.action ?? "HOLD",
        score: pendingOrder.score,
        gates: { trigger: false, time: false, regime: false, threshold: true },
      });
      shouldSkipEvaluation = true;
    } else {
      const exitValue = fillResult.filledShares * (fillResult.averagePrice ?? 0);
      const entryPrice = qmon.position.entryPrice ?? 0;
      const entryCost = fillResult.filledShares * entryPrice;
      const entryFee =
        entryPrice > 0 && fillResult.filledShares > 0 ? this.executionService.calculateHeldEntryTakerFeeUsd(fillResult.filledShares, entryPrice) : 0;
      const exitFee =
        (fillResult.averagePrice ?? 0) > 0 && fillResult.filledShares > 0
          ? this.executionService.calculateTakerFeeUsd(fillResult.filledShares, fillResult.averagePrice)
          : 0;
      const totalTradeFee = entryFee + exitFee;
      const totalTradePnl = exitValue - entryCost - totalTradeFee;
      const exitCashflow = exitValue - exitFee;
      const hasBookedEntryCashflow = this.hasBookedCurrentEntryCashflow(qmon);
      const pnlContribution = hasBookedEntryCashflow ? exitCashflow : totalTradePnl;

      updatedQmon = this.applyExitFill(qmon, pendingOrder, fillResult, pendingOrder.triggeredBy[0] ?? "signal-fill", now);
      const positionPnl: PositionPnlResult = {
        pnl: totalTradePnl,
        fee: totalTradeFee,
        exitFee,
        entryFee,
        grossPnl: exitValue - entryCost,
        exitPrice: fillResult.averagePrice,
        entryPrice: qmon.position.entryPrice ?? 0,
        shareCount: fillResult.filledShares,
        exitValue,
      };
      this.logPositionClosed(qmon, market, pendingOrder.triggeredBy[0] ?? "signal-fill", positionPnl, pnlContribution, isSeat);
      results.push({
        qmonId: qmon.id,
        action: "HOLD",
        score: positionPnl.pnl,
        gates: { trigger: false, time: false, regime: false, threshold: false },
      });
      shouldSkipEvaluation = true;
    }

    return { qmon: updatedQmon, shouldSkipEvaluation };
  }

  /**
   * Convert an open position into its corresponding exit action.
   */
  private getExitAction(position: QmonPosition): PendingOrderAction | null {
    let exitAction: PendingOrderAction | null = null;

    if (position.action === "BUY_UP") {
      exitAction = "SELL_UP";
    } else if (position.action === "BUY_DOWN") {
      exitAction = "SELL_DOWN";
    }

    return exitAction;
  }

  /**
   * Determine whether a stored position has reached its own settlement timestamp.
   */
  private hasReachedSettlementTime(qmon: Qmon, now: number): boolean {
    let hasReached = false;

    if (qmon.position.marketEndMs !== null) {
      hasReached = now >= qmon.position.marketEndMs;
    }

    return hasReached;
  }

  /**
   * Resolve the final per-share payout from the underlying final price versus priceToBeat.
   * BUY_UP wins when chainlink is at or above priceToBeat at settlement time.
   */
  private getSettledShareValue(qmon: Qmon, chainlinkPrice: number | null): number | null {
    let shareValue: number | null = null;
    const action = qmon.position.action;
    const priceToBeat = qmon.position.priceToBeat;

    if (action !== null && chainlinkPrice !== null && priceToBeat !== null) {
      const isUpWinner = chainlinkPrice >= priceToBeat;

      if (action === "BUY_UP") {
        shareValue = isUpWinner ? 1 : 0;
      } else if (action === "BUY_DOWN") {
        shareValue = isUpWinner ? 0 : 1;
      }
    }

    return shareValue;
  }

  /**
   * Prevent new entries once the current market window is no longer tradeable.
   */
  private shouldSkipEntry(isMarketClosed: boolean): boolean {
    let shouldSkip = false;

    if (isMarketClosed) {
      shouldSkip = true;
    }

    return shouldSkip;
  }

  /**
   * Track window age: if the market window changed, increment windowsLived and update currentWindowStart.
   * Must be called once per QMON per evaluation tick, before any position or entry logic.
   */
  private updateWindowAge(qmon: Qmon, marketStartMs: number | null): Qmon {
    let updatedQmon = qmon;

    if (marketStartMs !== null && qmon.currentWindowStart !== marketStartMs) {
      updatedQmon = {
        ...qmon,
        currentWindowStart: marketStartMs,
        windowsLived: qmon.windowsLived + 1,
        windowTradeCount: 0,
        paperWindowBaselinePnl: qmon.paperWindowBaselinePnl ?? qmon.metrics.totalPnl,
      };
    }

    return updatedQmon;
  }

  /**
   * Check if QMON has reached the maximum trades per window limit.
   */
  private hasReachedTradeLimit(qmon: Qmon): { shouldSkip: boolean; qmon: Qmon } {
    // Check if limit reached
    if (qmon.windowTradeCount >= qmon.genome.maxTradesPerWindow) {
      return { shouldSkip: true, qmon };
    }

    return { shouldSkip: false, qmon };
  }

  /**
   * Increment the trade counter for a QMON.
   */
  private incrementTradeCount(qmon: Qmon): Qmon {
    return {
      ...qmon,
      windowTradeCount: qmon.windowTradeCount + 1,
    };
  }

  /**
   * Build a proxy QMON that mirrors the operational market seat state.
   */
  private buildSeatProxyQmon(population: QmonPopulation, championQmon: Qmon, timestamp: number): Qmon {
    const seatDecisionHistory =
      population.seatPosition.action !== null && population.seatPosition.enteredAt !== null
        ? [
            {
              timestamp: population.seatPosition.enteredAt,
              market: championQmon.market,
              action: population.seatPosition.action,
              modelScore: population.seatPosition.entryScore,
              triggeredBy: [],
              cashflow: 0,
              fee: 0,
              executionPrice: population.seatPosition.entryPrice,
              entryPrice: population.seatPosition.entryPrice,
              shareCount: population.seatPosition.shareCount,
              priceImpactBps: null,
              isHydratedReplay: false,
              directionalAlpha: population.seatPosition.directionalAlpha ?? null,
              estimatedEdgeBps: population.seatPosition.estimatedEdgeBps ?? null,
              estimatedNetEvUsd: population.seatPosition.estimatedNetEvUsd ?? null,
              predictedSlippageBps: population.seatPosition.predictedSlippageBps ?? null,
              tradeabilityRejectReason: null,
              signalAgreementCount: population.seatPosition.signalAgreementCount ?? null,
              dominantSignalGroup: population.seatPosition.dominantSignalGroup ?? "none",
            },
          ]
        : [];

    return {
      ...championQmon,
      position: population.seatPosition,
      pendingOrder: population.seatPendingOrder,
      metrics: this.createEmptyMetrics(timestamp),
      decisionHistory: seatDecisionHistory,
      windowTradeCount: 0,
      paperWindowPnls: championQmon.paperWindowPnls,
      paperWindowSlippageBps: championQmon.paperWindowSlippageBps,
      paperWindowBaselinePnl: championQmon.paperWindowBaselinePnl,
      currentWindowStart: population.seatLastWindowStartMs,
      currentWindowSlippageTotalBps: 0,
      currentWindowSlippageFillCount: 0,
      lastCloseTimestamp: population.seatLastCloseTimestamp,
    };
  }

  /**
   * Sync the market seat fields from a proxy QMON after one simulated seat step.
   */
  private syncSeatState(population: QmonPopulation, seatProxyQmon: Qmon, marketPnlDelta: number, seatLastSettledWindowStartMs: number | null): QmonPopulation {
    return {
      ...population,
      marketConsolidatedPnl: population.marketConsolidatedPnl + marketPnlDelta,
      seatPosition: seatProxyQmon.position,
      seatPendingOrder: seatProxyQmon.pendingOrder,
      seatLastCloseTimestamp: seatProxyQmon.lastCloseTimestamp,
      seatLastWindowStartMs: seatProxyQmon.currentWindowStart,
      seatLastSettledWindowStartMs,
    };
  }

  private getPaperSessionPnlDelta(previousPopulation: QmonPopulation, updatedQmons: readonly Qmon[]): number {
    const previousChampionQmonId = previousPopulation.activeChampionQmonId;
    const previousChampionQmon =
      previousChampionQmonId === null ? null : (previousPopulation.qmons.find((qmon) => qmon.id === previousChampionQmonId) ?? null);
    const updatedChampionQmon =
      previousChampionQmonId === null ? null : (updatedQmons.find((qmon) => qmon.id === previousChampionQmonId) ?? null);
    let paperSessionPnlDelta = 0;

    if (previousChampionQmon !== null && updatedChampionQmon !== null) {
      paperSessionPnlDelta = updatedChampionQmon.metrics.totalPnl - previousChampionQmon.metrics.totalPnl;
    }

    return paperSessionPnlDelta;
  }

  /**
   * Sync a seat proxy result back into the population using the proxy totalPnl as the exact seat ledger delta.
   */
  private syncSeatProxyResult(population: QmonPopulation, seatProxyQmon: Qmon, seatLastSettledWindowStartMs: number | null): QmonPopulation {
    const updatedPopulation = this.syncSeatState(population, seatProxyQmon, seatProxyQmon.metrics.totalPnl, seatLastSettledWindowStartMs);

    return updatedPopulation;
  }

  /**
   * Keep the seat out of fresh entries when the champion is no longer operationally ready.
   */
  private isSeatChampionReady(population: QmonPopulation, championQmon: Qmon | null): boolean {
    let isReady = championQmon !== null;
    const currentChampionQmon = championQmon;

    if (isReady) {
      isReady = (currentChampionQmon?.lifecycle ?? null) === "active";
    }

    if (isReady) {
      isReady = currentChampionQmon?.metrics.isChampionEligible ?? false;
    }

    if (isReady) {
      isReady = (currentChampionQmon?.metrics.fitnessScore ?? Number.NEGATIVE_INFINITY) > 0;
    }

    if (isReady) {
      isReady = (currentChampionQmon?.metrics.championScore ?? Number.NEGATIVE_INFINITY) > 0;
    }

    if (isReady && config.QMON_REAL_REQUIRE_WALK_FORWARD && population.executionRuntime?.route === "real") {
      isReady = population.realWalkForwardGate?.isPassed ?? false;
    }

    return isReady;
  }

  /**
   * Drop stale queued seat entries once the current champion loses readiness.
   */
  private clearSeatEntryOrder(population: QmonPopulation): QmonPopulation {
    let updatedPopulation = population;

    if (population.seatPendingOrder?.kind === "entry" && population.seatPosition.action === null) {
      updatedPopulation = {
        ...population,
        seatPendingOrder: null,
      };
    }

    return updatedPopulation;
  }

  /**
   * Process one pending seat order against the same paper execution engine.
   */
  private processSeatPendingOrder(
    population: QmonPopulation,
    championQmon: Qmon,
    asset: string,
    window: string,
    now: number,
    market: MarketKey,
    snapshots?: readonly Snapshot[],
  ): SeatProcessingResult {
    const seatProxyQmon = this.buildSeatProxyQmon(population, championQmon, now);
    const seatResults: EvaluationResult[] = [];
    const seatProcessing = this.processPendingOrder(seatProxyQmon, asset, window, now, market, seatResults, snapshots, true);
    const seatPnlDelta = seatProcessing.qmon.metrics.totalPnl;
    const updatedPopulation = this.syncSeatState(population, seatProcessing.qmon, seatPnlDelta, population.seatLastSettledWindowStartMs);

    return {
      population: updatedPopulation,
      shouldSkipEvaluation: seatProcessing.shouldSkipEvaluation,
    };
  }

  /**
   * Settle the operational seat immediately at market close.
   */
  private settleSeatPosition(
    population: QmonPopulation,
    championQmon: Qmon,
    market: MarketKey,
    asset: string,
    window: string,
    upPrice: number | null,
    downPrice: number | null,
    chainlinkPrice: number | null,
    snapshots: readonly Snapshot[] | undefined,
  ): QmonPopulation {
    if (population.seatPosition.action === null) {
      this.logValidationWarning(market, "seat-settle-without-position", championQmon.id, "market seat attempted settlement while already flat");
      return population;
    }

    this.markStateMutation(true);
    const now = Date.now();
    const seatProxyQmon = this.buildSeatProxyQmon(population, championQmon, now);
    const settledSeatResult = this.settleOpenPosition(seatProxyQmon, market, asset, window, upPrice, downPrice, chainlinkPrice, snapshots);
    this.logPositionClosed(seatProxyQmon, market, "market-settled", settledSeatResult.positionPnl, settledSeatResult.pnlContribution, true);

    return this.syncSeatState(population, settledSeatResult.qmon, settledSeatResult.pnlContribution, seatProxyQmon.position.marketStartMs);
  }

  /**
   * Evaluate the operational market seat driven by the current champion.
   */
  private evaluateChampionSeat(
    population: QmonPopulation,
    championQmon: Qmon | null,
    marketSignals: Record<string, number | null | Record<string, number | null>>,
    firedTriggerIds: readonly string[],
    directionRegime: DirectionRegimeValue,
    volatilityRegime: VolatilityRegimeValue,
    timeSegment: TimeSegment,
    market: MarketKey,
    asset: string,
    window: string,
    upPrice: number | null,
    downPrice: number | null,
    chainlinkPrice: number | null,
    priceToBeat: number | null,
    marketStartMs: number | null,
    marketEndMs: number | null,
    isMarketClosed: boolean,
    snapshots?: readonly Snapshot[],
    evaluationOptions?: Partial<EvaluationOptions>,
  ): QmonPopulation {
    let updatedPopulation = population;
    const resolvedEvaluationOptions: EvaluationOptions = {
      shouldBlockEntries: evaluationOptions?.shouldBlockEntries ?? false,
      shouldBlockSeatEntries: evaluationOptions?.shouldBlockSeatEntries ?? evaluationOptions?.shouldBlockEntries ?? false,
      shouldSkipEvolution: evaluationOptions?.shouldSkipEvolution ?? false,
      executionMode: evaluationOptions?.executionMode ?? "paper",
    };
    const isChampionReady = this.isSeatChampionReady(population, championQmon);
    const isRealExecutionMarket = this.isRealExecutionMarket(updatedPopulation, resolvedEvaluationOptions);

    if (championQmon === null || championQmon.lifecycle !== "active") {
      return updatedPopulation;
    }

    const now = Date.now();
    let shouldSkipEvaluation = false;

    if (!isRealExecutionMarket && (isChampionReady || updatedPopulation.seatPosition.action !== null || updatedPopulation.seatPendingOrder?.kind === "exit")) {
      const pendingSeatProcessing = this.processSeatPendingOrder(updatedPopulation, championQmon, asset, window, now, market, snapshots);
      updatedPopulation = pendingSeatProcessing.population;
      shouldSkipEvaluation = pendingSeatProcessing.shouldSkipEvaluation;
    } else if (!isRealExecutionMarket) {
      updatedPopulation = this.clearSeatEntryOrder(updatedPopulation);
    }

    if (shouldSkipEvaluation) {
      return updatedPopulation;
    }

    const currentSeatProxyQmon = this.buildSeatProxyQmon(updatedPopulation, championQmon, now);
    const syncedSeatProxyQmon =
      currentSeatProxyQmon.position.action !== null ? this.syncOpenPositionPeakReturn(currentSeatProxyQmon, upPrice, downPrice) : currentSeatProxyQmon;

    if (isRealExecutionMarket && updatedPopulation.seatPendingOrder !== null) {
      if (syncedSeatProxyQmon.position.action !== null) {
        updatedPopulation = this.syncSeatProxyResult(updatedPopulation, syncedSeatProxyQmon, updatedPopulation.seatLastSettledWindowStartMs);
      }

      return updatedPopulation;
    }

    if (syncedSeatProxyQmon.position.action !== null) {
      updatedPopulation = this.syncSeatProxyResult(updatedPopulation, syncedSeatProxyQmon, updatedPopulation.seatLastSettledWindowStartMs);
      const shouldCloseSeatPosition = this.shouldClosePosition(syncedSeatProxyQmon, marketSignals, now, upPrice, downPrice, chainlinkPrice);

      if (shouldCloseSeatPosition.close) {
        if (shouldCloseSeatPosition.reason === "market-settled") {
          updatedPopulation = this.settleSeatPosition(updatedPopulation, championQmon, market, asset, window, upPrice, downPrice, chainlinkPrice, snapshots);
        } else {
          const queuedSeatQmon = this.queueExitOrder(
            syncedSeatProxyQmon,
            asset,
            window,
            market,
            now,
            shouldCloseSeatPosition.reason,
            this.calculateScore(championQmon, marketSignals),
            [],
            snapshots,
            true,
            !isRealExecutionMarket,
          );
          updatedPopulation = this.syncSeatProxyResult(updatedPopulation, queuedSeatQmon, updatedPopulation.seatLastSettledWindowStartMs);
        }
      }

      return updatedPopulation;
    }

    if (!isChampionReady) {
      return updatedPopulation;
    }

    if (resolvedEvaluationOptions.shouldBlockSeatEntries || this.shouldSkipEntry(isMarketClosed)) {
      return updatedPopulation;
    }

    if (updatedPopulation.seatLastCloseTimestamp !== null && now - updatedPopulation.seatLastCloseTimestamp < ENTRY_COOLDOWN_MS) {
      return updatedPopulation;
    }

    const championEvaluation = this.evaluateQmon(championQmon, marketSignals, firedTriggerIds, directionRegime, volatilityRegime, timeSegment);

    if (championEvaluation.action !== "HOLD") {
      if (updatedPopulation.seatPosition.action !== null) {
        this.logValidationWarning(
          market,
          "seat-double-open-blocked",
          championQmon.id,
          "market seat attempted a new entry while the previous seat position was still active",
        );
        return updatedPopulation;
      }

      const queuedSeatQmon = this.queueEntryOrder(
        currentSeatProxyQmon,
        championEvaluation.action as PendingOrderAction,
        championEvaluation.score,
        championEvaluation.tradeabilityAssessment ?? {
          directionalAlpha: championEvaluation.directionalAlpha ?? championEvaluation.score,
          estimatedEdgeBps: 0,
          estimatedNetEvUsd: championEvaluation.estimatedNetEvUsd ?? 0,
          predictedSlippageBps: 0,
          predictedFillQuality: 0,
          signalAgreementCount: 0,
          dominantSignalGroup: "none",
          tradeabilityRejectReason: championEvaluation.tradeabilityRejectReason ?? null,
          shouldAllowEntry: true,
        },
        this.getTriggeredBy(championQmon, firedTriggerIds),
        directionRegime,
        volatilityRegime,
        asset,
        window,
        market,
        priceToBeat,
        marketStartMs,
        marketEndMs,
        now,
        [],
        snapshots,
        true,
        !isRealExecutionMarket,
      );
      updatedPopulation = this.syncSeatProxyResult(
        {
          ...updatedPopulation,
          seatLastWindowStartMs: marketStartMs,
        },
        queuedSeatQmon,
        updatedPopulation.seatLastSettledWindowStartMs,
      );
    }

    return updatedPopulation;
  }

  /**
   * @section public:methods
   */

  /**
   * Initialize populations for all markets if they don't exist.
   * Creates 200 diverse QMONs per market (1600 total).
   */
  public initializePopulations(): void {
    const marketKeys = this.getMarketKeys();
    let newPopulations = [...this.familyState.populations];

    for (const market of marketKeys) {
      const existingIndex = newPopulations.findIndex((p) => p.market === market);
      const existing = existingIndex >= 0 ? (newPopulations[existingIndex] ?? null) : null;

      if (!existing || existing.qmons.length === 0) {
        // Generate 200 diverse genomes for this market
        const genomes = this.genomeService.generateInitialPopulation();
        const qmons: Qmon[] = [];

        for (const genome of genomes) {
          qmons.push(this.createQmon(market, 0, genome, []));
        }

        const newPopulation = this.createEmptyPopulation(market, qmons);

        // Replace or add the population
        if (existingIndex >= 0) {
          newPopulations = newPopulations.filter((p) => p.market !== market);
        }
        newPopulations = [...newPopulations, newPopulation];
      }
    }

    this.familyState = {
      ...this.familyState,
      populations: newPopulations,
      lastUpdated: Date.now(),
    };
    this.markStateMutation(true);
  }

  /**
   * Get the current family state.
   */
  public getFamilyState(): QmonFamilyState {
    return this.familyState;
  }

  /**
   * Apply route ownership for markets that should execute in real mode.
   */
  public applyExecutionRoutes(executionMode: "paper" | "real", timestamp: number): void {
    this.familyState = {
      ...this.familyState,
      populations: this.familyState.populations.map((population) => this.normalizePopulationExecutionRuntime(population, executionMode)),
      lastUpdated: timestamp,
    };
    this.markStateMutation(true);
  }

  /**
   * Get population for a specific market.
   */
  public getPopulation(market: MarketKey): QmonPopulation | null {
    return this.familyState.populations.find((p) => p.market === market) ?? null;
  }

  /**
   * Persist the canonical real-execution runtime for one market.
   */
  public setRealExecutionRuntime(market: MarketKey, executionRuntime: QmonExecutionRuntime, timestamp: number): void {
    const population = this.getPopulation(market);

    if (population === null) {
      return;
    }

    this.markStateMutation(true);
    this.replacePopulation({
      ...population,
      executionRuntime: {
        ...executionRuntime,
        executionState: this.resolveExecutionRuntimeState(executionRuntime),
      },
      lastUpdated: timestamp,
    });
  }

  /**
   * Get a specific QMON by ID.
   */
  public getQmon(id: QmonId): Qmon | null {
    for (const population of this.familyState.populations) {
      const qmon = population.qmons.find((q) => q.id === id);
      if (qmon) return qmon;
    }
    return null;
  }

  /**
   * Get all QMONs across all populations.
   */
  public getAllQmons(): readonly Qmon[] {
    const all: Qmon[] = [];
    for (const population of this.familyState.populations) {
      all.push(...population.qmons);
    }
    return all;
  }

  /**
   * Get QMONs for a specific market.
   */
  public getQmonsForMarket(market: MarketKey): readonly Qmon[] {
    const population = this.getPopulation(market);
    return population?.qmons ?? [];
  }

  /**
   * Update trigger events from the last evaluation.
   */
  public updateTriggers(triggers: readonly TriggerEvent[]): void {
    this.lastTriggers = [...triggers];
  }

  /**
   * Update snapshots for exchange-weighted signal recalculation.
   */
  public updateSnapshots(snapshots: readonly Snapshot[]): void {
    this.snapshots = snapshots;
  }

  /**
   * Evaluate all QMONs for all markets.
   * Returns decisions made by QMONs that passed all gates.
   */
  public evaluateAll(
    signals: StructuredSignalResult,
    regimes: RegimeResult,
    snapshots?: readonly Snapshot[],
    evaluationOptions?: Partial<EvaluationOptions>,
  ): EvaluationResult[] {
    const evaluationStartedAt = Date.now();
    const results: EvaluationResult[] = [];
    const firedTriggerIds = this.lastTriggers.map((t) => t.id);
    const latestSnapshot = snapshots?.[snapshots.length - 1] ?? this.snapshots[this.snapshots.length - 1] ?? null;

    this.resetEvaluationCaches();

    if (this.replayHistoryService !== null && latestSnapshot !== null) {
      this.replayHistoryService.recordSnapshot(latestSnapshot, signals);
    }

    for (const population of this.familyState.populations) {
      const result = this.evaluatePopulation(population.market, signals, regimes, firedTriggerIds, snapshots, evaluationOptions);
      results.push(...result);
    }

    this.evaluateAllRunCount += 1;
    this.evaluateAllDurationTotalMs += Date.now() - evaluationStartedAt;

    return results;
  }

  /**
   * Read and clear the runtime mutation flags for the latest evaluation cycle.
   */
  public consumeMutationState(): { readonly hasStateMutation: boolean; readonly hasCriticalMutation: boolean } {
    const mutationState = {
      hasStateMutation: this.hasStateMutation,
      hasCriticalMutation: this.hasCriticalMutation,
    };

    this.hasStateMutation = false;
    this.hasCriticalMutation = false;

    return mutationState;
  }

  /**
   * Evaluate all QMONs for a specific market.
   * Handles both opening new positions and closing existing ones.
   */
  public evaluatePopulation(
    market: MarketKey,
    signals: StructuredSignalResult,
    regimes: RegimeResult,
    firedTriggerIds: readonly string[],
    snapshots?: readonly Snapshot[],
    evaluationOptions?: Partial<EvaluationOptions>,
  ): EvaluationResult[] {
    const population = this.getPopulation(market);
    const resolvedEvaluationOptions: EvaluationOptions = {
      shouldBlockEntries: evaluationOptions?.shouldBlockEntries ?? false,
      shouldBlockSeatEntries: evaluationOptions?.shouldBlockSeatEntries ?? evaluationOptions?.shouldBlockEntries ?? false,
      shouldSkipEvolution: evaluationOptions?.shouldSkipEvolution ?? false,
      executionMode: evaluationOptions?.executionMode ?? "paper",
    };
    if (!population) {
      return [];
    }

    const parts = market.split("-");
    const asset = parts[0];
    const window = parts[1];
    if (!asset || !window) {
      return [];
    }

    const assetData = signals[asset];
    if (!assetData) {
      return [];
    }

    const windowData = assetData.windows[window];
    const regime = regimes[asset];
    const upPrice = windowData?.prices.upPrice ?? null;
    const downPrice = windowData?.prices.downPrice ?? null;
    const chainlinkPrice = assetData.chainlinkPrice ?? null;

    const timeSegment = this.computeTimeSegment(windowData?.prices.marketStartMs ?? null, windowData?.prices.marketEndMs ?? null);

    const results: EvaluationResult[] = [];
    const updatedQmons: Qmon[] = [];

    const now = Date.now();
    const marketEndTime = windowData?.prices.marketEndMs ?? null;
    const isMarketClosed = marketEndTime !== null && now >= marketEndTime;

    const marketStartMs = windowData?.prices.marketStartMs ?? null;
    let isNewWindow = false;

    for (let qmon of population.qmons) {
      // Track window age for every QMON regardless of position state
      const prevWindowStart = qmon.currentWindowStart;
      qmon = this.updateWindowAge(qmon, marketStartMs);
      const isWindowChange = qmon.currentWindowStart !== prevWindowStart && prevWindowStart !== null;
      if (isWindowChange) {
        isNewWindow = true;
      }

      // Get market signals with this QMON's exchange weights applied
      const marketSignals = this.getMarketSignals(market, signals, qmon, snapshots);

      // Retired QMONs stay archived and do not participate in evaluation.
      if (qmon.lifecycle !== "active") {
        updatedQmons.push(qmon);
        continue;
      }

      const pendingOrderProcessing = this.processPendingOrder(qmon, asset, window, now, market, results, snapshots);
      qmon = pendingOrderProcessing.qmon;

      if (pendingOrderProcessing.shouldSkipEvaluation) {
        updatedQmons.push(qmon);
        continue;
      }

      if (qmon.position.action !== null) {
        qmon = this.syncOpenPositionPeakReturn(qmon, upPrice, downPrice);
        const shouldClose = this.shouldClosePosition(qmon, marketSignals, now, upPrice, downPrice, chainlinkPrice);

        if (shouldClose.close) {
          if (shouldClose.reason === "market-settled") {
            const settledPositionResult = this.settleOpenPosition(qmon, market, asset, window, upPrice, downPrice, chainlinkPrice, snapshots);
            this.logPositionClosed(qmon, market, shouldClose.reason, settledPositionResult.positionPnl, settledPositionResult.pnlContribution);
            updatedQmons.push(settledPositionResult.qmon);
            results.push({
              qmonId: qmon.id,
              action: "HOLD",
              score: settledPositionResult.positionPnl.pnl,
              gates: { trigger: false, time: false, regime: false, threshold: false },
            });
            continue;
          }

          updatedQmons.push(
            this.queueExitOrder(qmon, asset, window, market, now, shouldClose.reason, this.calculateScore(qmon, marketSignals), results, snapshots),
          );
          continue;
        }

        updatedQmons.push(qmon);
        continue;
      }

      if (resolvedEvaluationOptions.shouldBlockEntries || this.shouldSkipEntry(isMarketClosed)) {
        updatedQmons.push(qmon);
        continue;
      }

      // Enforce cooldown after closing a position to prevent near-simultaneous trades
      if (qmon.lastCloseTimestamp !== null && now - qmon.lastCloseTimestamp < ENTRY_COOLDOWN_MS) {
        updatedQmons.push(qmon);
        continue;
      }

      // Check trade limit per window
      let qmonForEval = qmon;
      const tradeLimitCheck = this.hasReachedTradeLimit(qmon);
      if (tradeLimitCheck.shouldSkip) {
        // Add the (potentially updated) qmon and skip
        updatedQmons.push(tradeLimitCheck.qmon);
        continue;
      }
      qmonForEval = tradeLimitCheck.qmon;

      const result = this.evaluateQmon(qmonForEval, marketSignals, firedTriggerIds, regime?.direction ?? "flat", regime?.volatility ?? "normal", timeSegment);

      if (result.action !== "HOLD") {
        const priceToBeat = windowData?.prices.priceToBeat ?? null;
        const positionMarketStartMs = windowData?.prices.marketStartMs ?? null;
        const positionMarketEndMs = windowData?.prices.marketEndMs ?? null;
        updatedQmons.push(
          this.queueEntryOrder(
            qmonForEval,
            result.action as PendingOrderAction,
            result.score,
            result.tradeabilityAssessment ?? {
              directionalAlpha: result.directionalAlpha ?? result.score,
              estimatedEdgeBps: 0,
              estimatedNetEvUsd: result.estimatedNetEvUsd ?? 0,
              predictedSlippageBps: 0,
              predictedFillQuality: 0,
              signalAgreementCount: 0,
              dominantSignalGroup: "none",
              tradeabilityRejectReason: result.tradeabilityRejectReason ?? null,
              shouldAllowEntry: true,
            },
            this.getTriggeredBy(qmonForEval, firedTriggerIds),
            regime?.direction ?? "flat",
            regime?.volatility ?? "normal",
            asset,
            window,
            market,
            priceToBeat,
            positionMarketStartMs,
            positionMarketEndMs,
            now,
            results,
            snapshots,
          ),
        );
      } else {
        updatedQmons.push(qmonForEval);
      }
    }

    let updatedPopulation: QmonPopulation = {
      ...population,
      qmons: updatedQmons,
      marketPaperSessionPnl: population.marketPaperSessionPnl + this.getPaperSessionPnlDelta(population, updatedQmons),
      lastUpdated: now,
    };
    updatedPopulation = this.normalizePopulationExecutionRuntime(updatedPopulation, resolvedEvaluationOptions.executionMode);

    const activeChampionQmon =
      updatedPopulation.activeChampionQmonId !== null
        ? (updatedPopulation.qmons.find((qmon) => qmon.id === updatedPopulation.activeChampionQmonId) ?? null)
        : null;

    updatedPopulation = this.evaluateChampionSeat(
      updatedPopulation,
      activeChampionQmon,
      this.getMarketSignals(market, signals, activeChampionQmon ?? undefined, snapshots),
      firedTriggerIds,
      regime?.direction ?? "flat",
      regime?.volatility ?? "normal",
      timeSegment,
      market,
      asset,
      window,
      upPrice,
      downPrice,
      chainlinkPrice,
      windowData?.prices.priceToBeat ?? null,
      marketStartMs,
      marketEndTime,
      isMarketClosed,
      snapshots,
      resolvedEvaluationOptions,
    );

    if (isNewWindow) {
      const shouldPreserveSeatState =
        resolvedEvaluationOptions.executionMode === "real" && (updatedPopulation.seatPosition.action !== null || updatedPopulation.seatPendingOrder !== null);

      updatedPopulation = this.championService.finalizePopulation(
        updatedPopulation,
        updatedPopulation.qmons,
        this.createEmptyPosition(),
        shouldPreserveSeatState,
      );
      const evolutionResult =
        this.isEvolutionEnabled && !resolvedEvaluationOptions.shouldSkipEvolution
          ? this.evolutionService.evolvePopulation(
              updatedPopulation,
              this.hydrationService === null
                ? null
                : (newbornQmon, currentWindowStartMs) => this.hydrationService?.hydrateNewbornQmon(newbornQmon, currentWindowStartMs) ?? newbornQmon,
            )
          : {
              population: updatedPopulation,
              replacements: [],
              highestChildGeneration: null,
            };
      updatedPopulation = evolutionResult.population;

      for (const replacement of evolutionResult.replacements) {
        this.logQmonDied(market, replacement.deadQmonId, replacement.childQmonId, replacement.parentIds, replacement.generation, replacement.replacementCount);
        this.logQmonBorn(market, replacement.childQmonId, replacement.parentIds, replacement.generation, replacement.deadQmonId, replacement.replacementCount);
      }

      updatedPopulation = {
        ...updatedPopulation,
        lastUpdated: now,
      };
      const nextGlobalGeneration =
        evolutionResult.highestChildGeneration === null
          ? this.familyState.globalGeneration
          : Math.max(this.familyState.globalGeneration, evolutionResult.highestChildGeneration);
      this.familyState = {
        ...this.familyState,
        globalGeneration: nextGlobalGeneration,
      };
      this.markStateMutation(true);
    }

    this.replacePopulation({
      ...updatedPopulation,
      lastUpdated: now,
    });

    return results;
  }

  /**
   * Apply a confirmed real seat order to the same seat ledger used by paper execution.
   */
  public applyRealSeatPendingOrderFill(
    market: MarketKey,
    averagePrice: number,
    filledShares: number,
    timestamp: number,
    venuePositionShareCount: number | null = null,
  ): void {
    const population = this.getPopulation(market);
    const championQmon =
      population?.activeChampionQmonId !== null ? (population?.qmons.find((qmon) => qmon.id === population.activeChampionQmonId) ?? null) : null;

    if (population === null || championQmon === null || population.seatPendingOrder === null) {
      return;
    }

    this.markStateMutation(true);
    const seatProxyQmon = this.buildSeatProxyQmon(population, championQmon, timestamp);
    const fillResult = this.createRealFillResult(averagePrice, filledShares);
    const pendingOrder = population.seatPendingOrder;
    let updatedSeatProxyQmon = seatProxyQmon;
    let updatedPopulation = population;

    if (pendingOrder.kind === "entry") {
      updatedSeatProxyQmon = this.applyEntryFill(seatProxyQmon, pendingOrder, fillResult, timestamp);
      updatedSeatProxyQmon =
        venuePositionShareCount !== null && updatedSeatProxyQmon.position.action !== null
          ? {
              ...updatedSeatProxyQmon,
              position: {
                ...updatedSeatProxyQmon.position,
                shareCount: venuePositionShareCount,
              },
            }
          : updatedSeatProxyQmon;

      const entryShareCount = updatedSeatProxyQmon.position.shareCount ?? fillResult.filledShares;
      const entryFee =
        (fillResult.averagePrice ?? 0) > 0 && fillResult.filledShares > 0
          ? this.executionService.calculateTakerFeeUsd(fillResult.filledShares, fillResult.averagePrice)
          : 0;
      const entryCashflow = -(entryShareCount * (fillResult.averagePrice ?? 0) + entryFee);

      this.logPositionOpened(
        market,
        updatedSeatProxyQmon,
        updatedSeatProxyQmon.position.action ?? "HOLD",
        fillResult.averagePrice ?? 0,
        entryShareCount,
        entryCashflow,
        entryFee,
        entryCashflow,
        true,
      );
      updatedPopulation = this.syncSeatState(population, updatedSeatProxyQmon, updatedSeatProxyQmon.metrics.totalPnl, population.seatLastSettledWindowStartMs);
    } else {
      updatedSeatProxyQmon = this.applyExitFill(seatProxyQmon, pendingOrder, fillResult, pendingOrder.triggeredBy[0] ?? "signal-fill", timestamp);

      const exitValue = fillResult.filledShares * (fillResult.averagePrice ?? 0);
      const entryPrice = seatProxyQmon.position.entryPrice ?? 0;
      const entryCost = fillResult.filledShares * entryPrice;
      const entryFee =
        entryPrice > 0 && fillResult.filledShares > 0 ? this.executionService.calculateHeldEntryTakerFeeUsd(fillResult.filledShares, entryPrice) : 0;
      const exitFee =
        (fillResult.averagePrice ?? 0) > 0 && fillResult.filledShares > 0
          ? this.executionService.calculateTakerFeeUsd(fillResult.filledShares, fillResult.averagePrice)
          : 0;
      const totalTradeFee = entryFee + exitFee;
      const totalTradePnl = exitValue - entryCost - totalTradeFee;
      const exitCashflow = exitValue - exitFee;
      const hasBookedEntryCashflow = this.hasBookedCurrentEntryCashflow(seatProxyQmon);
      const pnlContribution = hasBookedEntryCashflow ? exitCashflow : totalTradePnl;
      const positionPnl: PositionPnlResult = {
        pnl: totalTradePnl,
        fee: totalTradeFee,
        exitFee,
        entryFee,
        grossPnl: exitValue - entryCost,
        exitPrice: fillResult.averagePrice,
        entryPrice,
        shareCount: fillResult.filledShares,
        exitValue,
      };

      this.logPositionClosed(seatProxyQmon, market, pendingOrder.triggeredBy[0] ?? "signal-fill", positionPnl, pnlContribution, true);
      updatedPopulation = this.syncSeatState(population, updatedSeatProxyQmon, pnlContribution, population.seatLastSettledWindowStartMs);
    }

    this.replacePopulation({
      ...updatedPopulation,
      lastUpdated: timestamp,
    });
  }

  /**
   * Clear one real seat pending order after a failed or cancelled live attempt.
   */
  public clearRealSeatPendingOrder(market: MarketKey, timestamp: number): void {
    const population = this.getPopulation(market);

    if (population === null || population.seatPendingOrder === null) {
      return;
    }

    this.markStateMutation(true);
    this.replacePopulation({
      ...population,
      seatPendingOrder: null,
      lastUpdated: timestamp,
    });
  }

  /**
   * Clear an unrecoverable live dust remainder after a confirmed exit leaves less than one venue-minimum order.
   */
  public clearRealSeatDustPosition(market: MarketKey, timestamp: number): void {
    const population = this.getPopulation(market);

    if (population === null || population.seatPosition.action === null) {
      return;
    }

    this.markStateMutation(true);
    this.replacePopulation({
      ...population,
      seatPosition: this.createEmptyPosition(),
      seatPendingOrder: null,
      seatLastCloseTimestamp: timestamp,
      lastUpdated: timestamp,
    });
  }

  /**
   * Determine if an open position should be closed.
   */
  private shouldClosePosition(
    qmon: Qmon,
    marketSignals: Record<string, number | null | Record<string, number | null>>,
    now: number,
    upPrice: number | null,
    downPrice: number | null,
    chainlinkPrice: number | null,
  ): PositionCloseDecision {
    const openPositionReturnPct = this.getOpenPositionReturnPct(qmon, upPrice, downPrice);
    const currentScore = this.calculateScore(qmon, marketSignals);
    const peakReturnPct = qmon.position.peakReturnPct ?? 0;
    const entryDirectionalAlpha = qmon.position.directionalAlpha ?? qmon.position.entryScore ?? 0;
    const entryDirectionMultiplier = qmon.position.action === "BUY_UP" ? 1 : -1;
    const currentImbalance = this.getScalarSignalValue(marketSignals, "imbalance") ?? 0;
    const thesisPolicy = qmon.genome.exitPolicy?.thesisInvalidationPolicy ?? "hybrid";
    const hasAlphaFlip = entryDirectionMultiplier * currentScore <= -THESIS_INVALIDATION_ALPHA_FLIP && entryDirectionMultiplier * entryDirectionalAlpha > 0;
    const hasMicrostructureFailure = entryDirectionMultiplier * currentImbalance <= -THESIS_INVALIDATION_MICROSTRUCTURE_FLOOR;
    const hasThesisInvalidation =
      thesisPolicy === "alpha-flip"
        ? hasAlphaFlip
        : thesisPolicy === "microstructure-failure"
          ? hasMicrostructureFailure
          : hasAlphaFlip || hasMicrostructureFailure;
    const hasStopLoss =
      qmon.genome.stopLossPct > 0 &&
      openPositionReturnPct !== null &&
      openPositionReturnPct <= -qmon.genome.stopLossPct &&
      this.hasStopLossAgeBuffer(qmon, now);
    const hasTakeProfit =
      qmon.genome.takeProfitPct > 0 &&
      openPositionReturnPct !== null &&
      peakReturnPct > qmon.genome.takeProfitPct &&
      openPositionReturnPct <= qmon.genome.takeProfitPct;
    let closeDecision: PositionCloseDecision = { close: false, reason: "" };

    if (this.hasReachedSettlementTime(qmon, now) && this.getSettledShareValue(qmon, chainlinkPrice) !== null) {
      closeDecision = { close: true, reason: "market-settled" };
    } else if (hasThesisInvalidation) {
      closeDecision = { close: true, reason: "thesis-invalidated" };
    } else if (hasStopLoss) {
      closeDecision = { close: true, reason: "stop-loss-hit" };
    } else if (hasTakeProfit) {
      closeDecision = { close: true, reason: "take-profit-hit" };
    }

    return closeDecision;
  }

  /**
   * Calculate current unrealized return percentage for an open token position.
   */
  private getOpenPositionReturnPct(qmon: Qmon, upPrice: number | null, downPrice: number | null): number | null {
    const entryPrice = qmon.position.entryPrice ?? null;
    const action = qmon.position.action;
    const currentTokenPrice = action === "BUY_UP" ? upPrice : action === "BUY_DOWN" ? downPrice : null;
    let openPositionReturnPct: number | null = null;

    if (entryPrice !== null && entryPrice > 0 && currentTokenPrice !== null) {
      openPositionReturnPct = (currentTokenPrice - entryPrice) / entryPrice;
    }

    return openPositionReturnPct;
  }

  /**
   * Calculate PnL for a closed position.
   * Uses executable exit prices for normal closes and binary payout at settlement.
   */
  private calculatePositionPnl(
    qmon: Qmon,
    _asset: string,
    _window: string,
    _upPrice: number | null,
    _downPrice: number | null,
    chainlinkPrice: number | null,
    isSettlementClose: boolean,
    _snapshots?: readonly Snapshot[],
  ): PositionPnlResult {
    const entryPrice = qmon.position.entryPrice ?? 0;
    const shareCount = qmon.position.shareCount ?? 0;
    const exitPrice = isSettlementClose ? this.getSettledShareValue(qmon, chainlinkPrice) : null;

    // Exit value: what we receive when selling/closing
    const exitValue = exitPrice !== null ? shareCount * exitPrice : 0;

    // Entry cost: what we paid when buying
    const entryCost = shareCount * entryPrice;
    const entryFee = entryPrice > 0 && shareCount > 0 ? this.executionService.calculateHeldEntryTakerFeeUsd(shareCount, entryPrice) : 0;
    const exitFee = 0;
    const totalFee = entryFee + exitFee;
    const pnl = exitValue - entryCost - totalFee;

    return {
      pnl,
      fee: totalFee,
      exitFee,
      entryFee,
      grossPnl: exitValue - entryCost,
      exitPrice,
      entryPrice,
      shareCount,
      exitValue,
    };
  }

  /**
   * Close a position and update metrics.
   * @param exitValue - The value received at exit (shareCount × exitPrice)
   * @param fee - Trading fees paid
   */
  private closePosition(qmon: Qmon, exitValue: number, fee: number, reason: string, market: MarketKey): Qmon {
    const shareCount = qmon.position.shareCount ?? 0;
    const entryPrice = qmon.position.entryPrice ?? 0;
    const entryCost = shareCount * entryPrice;
    const entryFee = entryPrice > 0 && shareCount > 0 ? this.executionService.calculateHeldEntryTakerFeeUsd(shareCount, entryPrice) : 0;
    const totalTradePnl = exitValue - entryCost - entryFee - fee;
    const exitCashflow = exitValue - fee;
    const hasBookedEntryCashflow = this.hasBookedCurrentEntryCashflow(qmon);
    const pnlDelta = hasBookedEntryCashflow ? exitCashflow : totalTradePnl;

    const exitDecision: QmonDecision = {
      timestamp: Date.now(),
      market,
      action: "HOLD",
      modelScore: qmon.position.entryScore,
      triggeredBy: [reason],
      cashflow: exitCashflow,
      fee,
      executionPrice: shareCount > 0 ? exitValue / shareCount : null,
      entryPrice: qmon.position.entryPrice ?? null,
      shareCount,
      priceImpactBps: null,
      isHydratedReplay: false,
      directionalAlpha: qmon.position.directionalAlpha ?? qmon.position.entryScore,
      estimatedEdgeBps: qmon.position.estimatedEdgeBps ?? null,
      estimatedNetEvUsd: qmon.position.estimatedNetEvUsd ?? null,
      predictedSlippageBps: qmon.position.predictedSlippageBps ?? null,
      tradeabilityRejectReason: null,
      signalAgreementCount: qmon.position.signalAgreementCount ?? null,
      dominantSignalGroup: qmon.position.dominantSignalGroup ?? "none",
    };

    const currentMetrics = qmon.metrics;
    const newTotalTrades = currentMetrics.totalTrades + 1;
    const newTotalPnl = currentMetrics.totalPnl + pnlDelta;
    const newTotalFees = currentMetrics.totalFeesPaid + fee;
    const newWinCount = currentMetrics.winCount + (totalTradePnl > 0 ? 1 : 0);
    const newWinRate = newTotalTrades > 0 ? newWinCount / newTotalTrades : 0;

    const newMetrics = this.updateClosedTradeMetrics(
      {
        ...currentMetrics,
        totalTrades: newTotalTrades,
        totalPnl: newTotalPnl,
        totalFeesPaid: newTotalFees,
        winRate: newWinRate,
        winCount: newWinCount,
        lastUpdate: Date.now(),
      },
      qmon.position,
      totalTradePnl,
      newTotalPnl,
    );

    return this.refreshQmonMetrics({
      ...qmon,
      position: this.createEmptyPosition(),
      pendingOrder: null,
      metrics: newMetrics,
      decisionHistory: this.addDecision(qmon, exitDecision),
      lastCloseTimestamp: Date.now(),
    });
  }

  /**
   * Calculate current score for a QMON (for exit logic).
   * Must use the same normalization as computeScore to keep entry/exit thresholds consistent.
   */
  private calculateScore(qmon: Qmon, marketSignals: Record<string, number | null | Record<string, number | null>>): number {
    return this.computeScore(qmon, marketSignals);
  }

  /**
   * Evaluate a single QMON against current market conditions.
   */
  public evaluateQmon(
    qmon: Qmon,
    signalValues: Record<string, number | null | Record<string, number | null>>,
    firedTriggerIds: readonly string[],
    directionRegime: DirectionRegimeValue,
    volatilityRegime: VolatilityRegimeValue,
    timeSegment: TimeSegment,
  ): EvaluationResult {
    const triggerGate = this.checkTriggerGate(qmon, firedTriggerIds);
    if (!triggerGate.passed) {
      return {
        qmonId: qmon.id,
        action: "HOLD",
        score: 0,
        directionalAlpha: 0,
        estimatedNetEvUsd: 0,
        tradeabilityRejectReason: "trigger-gate-blocked",
        gates: {
          trigger: false,
          time: false,
          regime: false,
          threshold: false,
        },
      };
    }

    const timeGate = this.checkTimeGate(qmon, timeSegment);
    if (!timeGate.passed) {
      return {
        qmonId: qmon.id,
        action: "HOLD",
        score: 0,
        directionalAlpha: 0,
        estimatedNetEvUsd: 0,
        tradeabilityRejectReason: "time-gate-blocked",
        gates: {
          trigger: triggerGate.passed,
          time: false,
          regime: false,
          threshold: false,
        },
      };
    }

    const regimeGate = this.checkRegimeGate(qmon, directionRegime, volatilityRegime);
    if (!regimeGate.passed) {
      return {
        qmonId: qmon.id,
        action: "HOLD",
        score: 0,
        directionalAlpha: 0,
        estimatedNetEvUsd: 0,
        tradeabilityRejectReason: "regime-gate-blocked",
        gates: {
          trigger: triggerGate.passed,
          time: true,
          regime: false,
          threshold: false,
        },
      };
    }

    const selectedAction =
      this.computeDirectionalAlpha(qmon, signalValues).directionalAlpha >= (qmon.genome.minScoreBuy ?? 0.25)
        ? "BUY_UP"
        : this.computeDirectionalAlpha(qmon, signalValues).directionalAlpha <= -(qmon.genome.minScoreSell ?? 0.25)
          ? "BUY_DOWN"
          : "HOLD";
    const bestExecutablePrice = this.getLimitPriceForAction(signalValues, selectedAction);
    const entryDecision = this.buildEntryDecision(qmon, signalValues, firedTriggerIds, bestExecutablePrice);
    const thresholdPassed = entryDecision.action !== "HOLD" && entryDecision.tradeabilityAssessment.shouldAllowEntry;

    return {
      qmonId: qmon.id,
      action: thresholdPassed ? entryDecision.action : "HOLD",
      score: entryDecision.tradeabilityAssessment.directionalAlpha,
      directionalAlpha: entryDecision.tradeabilityAssessment.directionalAlpha,
      estimatedNetEvUsd: entryDecision.tradeabilityAssessment.estimatedNetEvUsd,
      tradeabilityRejectReason: thresholdPassed ? null : entryDecision.tradeabilityAssessment.tradeabilityRejectReason,
      tradeabilityAssessment: entryDecision.tradeabilityAssessment,
      gates: {
        trigger: triggerGate.passed,
        time: true,
        regime: true,
        threshold: thresholdPassed,
      },
    };
  }

  /**
   * Update family state (used after loading from persistence).
   */
  public setFamilyState(state: QmonFamilyState): void {
    this.familyState = {
      ...state,
      populations: state.populations.map((population) => ({
        ...this.normalizePopulationExecutionRuntime(population),
        qmons: population.qmons.map((qmon) => this.refreshQmonMetrics(qmon)),
      })),
    };
    this.stateSnapshotVersion += 1;
  }

  /**
   * Expose a stable mutation version so the HTTP layer can cache expensive payloads.
   */
  public getStateSnapshotVersion(): number {
    return this.stateSnapshotVersion;
  }

  /**
   * Get statistics about the current family state.
   */
  public getStats(): QmonEngineStats {
    let totalQmons = 0;
    let totalDecisions = 0;
    let averageEvaluateAllDurationMs = 0;

    for (const pop of this.familyState.populations) {
      totalQmons += pop.qmons.length;
      for (const qmon of pop.qmons) {
        totalDecisions += qmon.metrics.totalTrades;
      }
    }

    if (this.evaluateAllRunCount > 0) {
      averageEvaluateAllDurationMs = this.evaluateAllDurationTotalMs / this.evaluateAllRunCount;
    }

    return {
      totalPopulations: this.familyState.populations.length,
      totalQmons,
      totalDecisions,
      globalGeneration: this.familyState.globalGeneration,
      metricsRefreshCount: this.metricsRefreshCount,
      marketSignalsCacheHits: this.marketSignalsCacheHits,
      marketSignalsCacheMisses: this.marketSignalsCacheMisses,
      averageEvaluateAllDurationMs,
      stateSnapshotVersion: this.stateSnapshotVersion,
    };
  }
}
