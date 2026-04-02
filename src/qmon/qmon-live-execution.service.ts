/**
 * @section imports:externals
 */

import { MarketCatalogService, OrderService } from "@sha3/polymarket";
import polymarketConfig from "@sha3/polymarket/dist/config.js";
import type {
  CryptoMarketWindow,
  CryptoSymbol,
  PendingConfirmationOrder,
  PolymarketMarket,
  PostedOrderWithStatus,
} from "@sha3/polymarket";
import type { SignatureType } from "@polymarket/order-utils";

/**
 * @section imports:internals
 */

import logger from "../logger.ts";
import type {
  BalanceSnapshotState,
  ConfirmedLiveSeatSummary,
  ExecutionMode,
  MarketExecutionRoute,
  RuntimeExecutionStatus,
} from "../app/app-runtime.types.ts";
import config from "../config.ts";
import type { StructuredSignalResult } from "../signal/signal.types.ts";
import type {
  MarketKey,
  QmonConfirmedVenueSeat,
  QmonExecutionRuntime,
  QmonPendingOrder,
  QmonPendingVenueOrderSnapshot,
  QmonPopulation,
} from "./qmon.types.ts";
import type { QmonEngine } from "./qmon-engine.service.ts";
import { QmonLiveStatePersistenceService } from "./qmon-live-state-persistence.service.ts";
import type { QmonValidationLogService } from "./qmon-validation-log.service.ts";
import type { PersistedLiveExecutionState } from "./qmon-live-state-persistence.service.ts";

/**
 * @section consts
 */

const BALANCE_ERROR_PATTERNS = ["balance", "allowance", "insufficient"];
const REAL_ACTIVITY_EVENT_TYPES = new Set([
  "live-order-posted",
  "live-order-confirmed",
  "live-order-cancelled",
  "live-reconcile-started",
  "live-reconcile-pending",
  "live-reconcile-confirmed",
  "live-reconcile-failed",
  "live-window-reset",
]);
const REAL_ACTIVITY_WARNING_CODES = new Set([
  "live-order-expired",
  "live-order-failed",
  "live-order-threw",
  "live-recovery-required",
  "live-routing-halted",
]);

/**
 * @section types
 */

type LiveBalanceSnapshot = {
  readonly balanceUsd: number | null;
  readonly balanceState: BalanceSnapshotState;
  readonly balanceUpdatedAt: number | null;
};

type LiveMarketCache = {
  readonly market: PolymarketMarket;
  readonly windowStartMs: number | null;
};

type InitializeLiveExecutionOptions = {
  readonly mode: ExecutionMode;
  readonly privateKey?: string;
  readonly funderAddress?: string;
  readonly signatureType?: SignatureType;
  readonly maxAllowedSlippage?: number;
  readonly confirmationTimeoutMs: number;
  readonly persistedState?: PersistedLiveExecutionState | null;
  readonly cpnlSessionStartedAt: number | null;
};

type LiveOrderAttemptResult = {
  readonly confirmation: PostedOrderWithStatus | null;
  readonly errorMessage: string | null;
  readonly orderId: string | null;
};

/**
 * @section class
 */

export class QmonLiveExecutionService {
  /**
   * @section private:attributes
   */

  private readonly orderService: OrderService;
  private readonly marketCatalogService: MarketCatalogService;
  private readonly liveStatePersistenceService: QmonLiveStatePersistenceService;
  private readonly validationLogService: QmonValidationLogService | null;
  private mode: ExecutionMode;
  private confirmationTimeoutMs: number;
  private cpnlSessionStartedAt: number | null;
  private balanceSnapshot: LiveBalanceSnapshot;
  private readonly liveMarketCacheByMarket: Map<MarketKey, LiveMarketCache>;
  private isInitialized: boolean;
  private syncQueue: Promise<void>;

  /**
   * @section constructor
   */

  public constructor(
    orderService?: OrderService,
    marketCatalogService?: MarketCatalogService,
    liveStatePersistenceService?: QmonLiveStatePersistenceService,
    validationLogService: QmonValidationLogService | null = null,
  ) {
    this.orderService = orderService ?? OrderService.createDefault();
    this.marketCatalogService = marketCatalogService ?? MarketCatalogService.createDefault();
    this.liveStatePersistenceService = liveStatePersistenceService ?? QmonLiveStatePersistenceService.createDefault("./data");
    this.validationLogService = validationLogService;
    this.mode = "paper";
    this.confirmationTimeoutMs = 15_000;
    this.cpnlSessionStartedAt = null;
    this.balanceSnapshot = {
      balanceUsd: null,
      balanceState: "unavailable",
      balanceUpdatedAt: null,
    };
    this.liveMarketCacheByMarket = new Map();
    this.isInitialized = false;
    this.syncQueue = Promise.resolve();
  }

  /**
   * @section public:methods
   */

  public async initialize(options: InitializeLiveExecutionOptions): Promise<void> {
    this.mode = options.mode;
    this.confirmationTimeoutMs = options.confirmationTimeoutMs;
    this.cpnlSessionStartedAt = options.cpnlSessionStartedAt;
    this.applyPolymarketSafetyConfig();

    if (options.mode === "real") {
      if (!options.privateKey) {
        throw new Error("POLYMARKET_PRIVATE_KEY is required when QMON_EXECUTION_MODE=real");
      }

      const initOptions: {
        readonly privateKey: string;
        readonly funderAddress?: string;
        readonly signatureType?: SignatureType;
        readonly maxAllowedSlippage?: number;
      } = {
        privateKey: options.privateKey,
      };

      if (options.funderAddress !== undefined) {
        Object.assign(initOptions, {
          funderAddress: options.funderAddress,
        });
      }

      if (options.signatureType !== undefined) {
        Object.assign(initOptions, {
          signatureType: options.signatureType,
        });
      }

      if (options.maxAllowedSlippage !== undefined) {
        Object.assign(initOptions, {
          maxAllowedSlippage: options.maxAllowedSlippage,
        });
      }

      await this.orderService.init(initOptions);
      this.isInitialized = true;
      await this.refreshBalanceSnapshot();
    }
  }

  public queueSync(qmonEngine: QmonEngine, latestSignals: StructuredSignalResult | null): void {
    if (this.mode === "real" && this.isInitialized && latestSignals !== null) {
      const previousSyncQueue = this.syncQueue;

      this.syncQueue = this.runSync(qmonEngine, latestSignals, previousSyncQueue);
    }
  }

  public async flush(): Promise<void> {
    await this.syncQueue;
  }

  public getStatus(populations: readonly QmonPopulation[]): RuntimeExecutionStatus {
    const marketRoutes: MarketExecutionRoute[] = [];

    for (const population of populations) {
      const hasRealRouting = this.mode === "real";
      const executionRuntime = this.getExecutionRuntime(population, hasRealRouting ? "real" : "paper");
      const confirmedLiveSeat = hasRealRouting ? this.buildConfirmedLiveSeatSummary(executionRuntime.confirmedVenueSeat) : null;
      const pendingIntentKey = hasRealRouting && executionRuntime.pendingIntent !== null ? this.buildPendingIntentKey(executionRuntime.pendingIntent) : null;
      const marketExecutionRoute: MarketExecutionRoute = {
        market: population.market,
        route: hasRealRouting ? "real" : "paper",
        executionState: hasRealRouting ? executionRuntime.executionState : "paper",
        isHalted: hasRealRouting ? executionRuntime.isHalted : false,
        hasPendingIntent: hasRealRouting ? executionRuntime.pendingIntent !== null : false,
        pendingIntentKey,
        pendingIntent: hasRealRouting ? executionRuntime.pendingIntent : null,
        orderId: hasRealRouting ? executionRuntime.orderId : null,
        submittedAt: hasRealRouting ? executionRuntime.submittedAt : null,
        pendingVenueOrders: hasRealRouting ? executionRuntime.pendingVenueOrders : [],
        recoveryStartedAt: hasRealRouting ? executionRuntime.recoveryStartedAt : null,
        lastReconciledAt: hasRealRouting ? executionRuntime.lastReconciledAt : null,
        hasLivePosition: confirmedLiveSeat !== null,
        livePositionAction: confirmedLiveSeat?.action ?? null,
        confirmedLiveSeat,
        lastError: hasRealRouting ? executionRuntime.lastError : null,
      };

      marketRoutes.push(marketExecutionRoute);
    }

    return {
      mode: this.mode,
      balanceUsd: this.balanceSnapshot.balanceUsd,
      balanceState: this.balanceSnapshot.balanceState,
      balanceUpdatedAt: this.balanceSnapshot.balanceUpdatedAt,
      cpnlSessionStartedAt: this.cpnlSessionStartedAt,
      marketRoutes,
    };
  }

  /**
   * @section private:methods
   */

  private applyPolymarketSafetyConfig(): void {
    const mutablePolymarketConfig = polymarketConfig as { SAFE_MAX_BUY_AMOUNT: number };

    mutablePolymarketConfig.SAFE_MAX_BUY_AMOUNT = config.POLYMARKET_SAFE_MAX_BUY_AMOUNT;
  }

  private createDefaultExecutionRuntime(route: "paper" | "real"): QmonExecutionRuntime {
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

  private resolveExecutionState(executionRuntime: QmonExecutionRuntime): QmonExecutionRuntime["executionState"] {
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

  private getExecutionRuntime(population: QmonPopulation | null, route: "paper" | "real"): QmonExecutionRuntime {
    const currentExecutionRuntime = population?.executionRuntime ?? this.createDefaultExecutionRuntime(route);
    const nextExecutionRuntime: QmonExecutionRuntime = {
      route,
      executionState: currentExecutionRuntime.executionState,
      pendingIntent: route === "real" ? population?.seatPendingOrder ?? currentExecutionRuntime.pendingIntent : null,
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
      ...nextExecutionRuntime,
      executionState: this.resolveExecutionState(nextExecutionRuntime),
    };
  }

  private async updateExecutionRuntime(
    qmonEngine: QmonEngine,
    market: MarketKey,
    overrides: Partial<QmonExecutionRuntime>,
    timestamp: number,
  ): Promise<QmonExecutionRuntime> {
    const population = qmonEngine.getPopulation(market);
    const currentExecutionRuntime = this.getExecutionRuntime(population, "real");
    const nextExecutionRuntime: QmonExecutionRuntime = {
      ...currentExecutionRuntime,
      ...overrides,
      route: "real",
    };

    qmonEngine.setRealExecutionRuntime(
      market,
      {
        ...nextExecutionRuntime,
        executionState: this.resolveExecutionState(nextExecutionRuntime),
      },
      timestamp,
    );

    return this.getExecutionRuntime(qmonEngine.getPopulation(market), "real");
  }

  private buildConfirmedLiveSeatSummary(confirmedVenueSeat: QmonConfirmedVenueSeat | null): ConfirmedLiveSeatSummary | null {
    let confirmedLiveSeatSummary: ConfirmedLiveSeatSummary | null = null;

    if (confirmedVenueSeat !== null) {
      confirmedLiveSeatSummary = {
        action: confirmedVenueSeat.action,
        shareCount: confirmedVenueSeat.shareCount,
        entryPrice: confirmedVenueSeat.entryPrice,
        enteredAt: confirmedVenueSeat.enteredAt,
      };
    }

    return confirmedLiveSeatSummary;
  }

  private createConfirmedVenueSeatFromPopulation(population: QmonPopulation | null): QmonConfirmedVenueSeat | null {
    const seatPosition = population?.seatPosition ?? null;
    let confirmedVenueSeat: QmonConfirmedVenueSeat | null = null;

    if (seatPosition !== null && seatPosition.action !== null && seatPosition.shareCount !== null && seatPosition.enteredAt !== null) {
      confirmedVenueSeat = {
        action: seatPosition.action,
        shareCount: seatPosition.shareCount,
        entryPrice: seatPosition.entryPrice,
        enteredAt: seatPosition.enteredAt,
      };
    }

    return confirmedVenueSeat;
  }

  private getCurrentWindowStartMs(marketKey: MarketKey, latestSignals: StructuredSignalResult): number | null {
    const [asset, window] = marketKey.split("-");
    const assetSignals = asset ? latestSignals[asset] : null;
    const windowSignals = assetSignals?.windows?.[window ?? ""] ?? null;
    const currentWindowStartMs = windowSignals?.prices?.marketStartMs ?? null;

    return currentWindowStartMs;
  }

  private getRuntimeWindowStartMs(population: QmonPopulation, executionRuntime: QmonExecutionRuntime): number | null {
    const runtimeWindowStartMs =
      executionRuntime.pendingIntent?.marketStartMs ??
      population.seatPendingOrder?.marketStartMs ??
      population.seatPosition.marketStartMs ??
      executionRuntime.submittedAt ??
      population.seatLastWindowStartMs;

    return runtimeWindowStartMs;
  }

  private hasActiveLiveRisk(population: QmonPopulation, executionRuntime: QmonExecutionRuntime): boolean {
    const hasActiveRisk =
      executionRuntime.orderId !== null ||
      executionRuntime.pendingVenueOrders.length > 0 ||
      executionRuntime.confirmedVenueSeat !== null ||
      executionRuntime.pendingIntent !== null ||
      population.seatPendingOrder !== null ||
      population.seatPosition.action !== null;

    return hasActiveRisk;
  }

  private shouldResetWindowScopedRuntime(
    population: QmonPopulation,
    executionRuntime: QmonExecutionRuntime,
    currentWindowStartMs: number | null,
  ): boolean {
    const runtimeWindowStartMs = this.getRuntimeWindowStartMs(population, executionRuntime);
    const hasWindowScopedBlock = executionRuntime.isHalted || executionRuntime.lastError !== null;
    let shouldResetWindowScopedRuntime = false;

    if (currentWindowStartMs !== null && runtimeWindowStartMs !== null && hasWindowScopedBlock) {
      shouldResetWindowScopedRuntime = runtimeWindowStartMs < currentWindowStartMs && !this.hasActiveLiveRisk(population, executionRuntime);
    }

    return shouldResetWindowScopedRuntime;
  }

  private shouldBlockFreshEntryForCurrentWindow(
    executionRuntime: QmonExecutionRuntime,
    pendingOrder: QmonPendingOrder | null,
    currentWindowStartMs: number | null,
  ): boolean {
    const isEntryOrder = pendingOrder?.kind === "entry";
    const hasWindowScopedError =
      executionRuntime.lastError !== null &&
      executionRuntime.submittedAt !== null &&
      executionRuntime.orderId === null &&
      executionRuntime.confirmedVenueSeat === null &&
      !executionRuntime.isHalted;
    let shouldBlockFreshEntry = false;

    if (isEntryOrder && hasWindowScopedError && currentWindowStartMs !== null) {
      shouldBlockFreshEntry = executionRuntime.submittedAt >= currentWindowStartMs;
    }

    return shouldBlockFreshEntry;
  }

  private buildPendingIntentKey(pendingOrder: QmonPendingOrder): string {
    return [
      pendingOrder.market,
      pendingOrder.kind,
      pendingOrder.action,
      pendingOrder.createdAt,
      pendingOrder.requestedShares.toFixed(6),
      pendingOrder.limitPrice.toFixed(6),
    ].join(":");
  }

  private hasLiveSeatDivergence(population: QmonPopulation, executionRuntime: QmonExecutionRuntime): boolean {
    const localSeatAction = population.seatPosition.action;
    const confirmedLiveAction = executionRuntime.confirmedVenueSeat?.action ?? null;
    const hasConfirmedLiveAction = confirmedLiveAction !== null;
    const hasActionMismatch = hasConfirmedLiveAction && localSeatAction !== confirmedLiveAction;
    const hasUnexpectedEntryIntent = executionRuntime.confirmedVenueSeat !== null && population.seatPendingOrder?.kind === "entry";
    const hasUnexpectedExitIntent = executionRuntime.confirmedVenueSeat === null && population.seatPendingOrder?.kind === "exit";

    return hasActionMismatch || hasUnexpectedEntryIntent || hasUnexpectedExitIntent;
  }

  private async reconcileRecoverableSeatDrift(
    qmonEngine: QmonEngine,
    market: MarketKey,
    population: QmonPopulation,
    executionRuntime: QmonExecutionRuntime,
  ): Promise<QmonExecutionRuntime | null> {
    const hasTrackedOrder = executionRuntime.orderId !== null || executionRuntime.pendingIntent !== null || executionRuntime.pendingVenueOrders.length > 0;
    const localSeatAction = population.seatPosition.action;
    const confirmedVenueSeat = executionRuntime.confirmedVenueSeat;
    let reconciledExecutionRuntime: QmonExecutionRuntime | null = null;

    if (!hasTrackedOrder && localSeatAction === null && confirmedVenueSeat !== null) {
      reconciledExecutionRuntime = await this.updateExecutionRuntime(qmonEngine, market, {
        confirmedVenueSeat: null,
        isHalted: false,
        recoveryStartedAt: null,
        lastError: null,
        lastReconciledAt: Date.now(),
      }, Date.now());
    }

    return reconciledExecutionRuntime;
  }

  private async runSync(
    qmonEngine: QmonEngine,
    latestSignals: StructuredSignalResult,
    previousSyncQueue: Promise<void>,
  ): Promise<void> {
    try {
      await previousSyncQueue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logLiveWarning("system", "live-sync-queue-failed", message);
    }

    const pendingVenueOrders = await this.listActiveOrdersPendingConfirmation();

    for (const population of qmonEngine.getFamilyState().populations) {
      const market = population.market;

      await this.syncMarket(qmonEngine, population, latestSignals, pendingVenueOrders);
    }
  }

  private async syncMarket(
    qmonEngine: QmonEngine,
    population: QmonPopulation,
    latestSignals: StructuredSignalResult,
    pendingVenueOrders: readonly PendingConfirmationOrder[],
  ): Promise<void> {
    const now = Date.now();
    const currentWindowStartMs = this.getCurrentWindowStartMs(population.market, latestSignals);
    let currentPopulation = qmonEngine.getPopulation(population.market) ?? population;
    let executionRuntime = await this.updateExecutionRuntime(qmonEngine, population.market, {}, now);
    let liveMarket: PolymarketMarket | null = null;

    if (executionRuntime.pendingIntent !== null || executionRuntime.orderId !== null) {
      liveMarket = await this.resolveLiveMarket(population.market, latestSignals);
    }

    const marketPendingVenueOrders = this.filterPendingVenueOrdersForMarket(
      pendingVenueOrders,
      executionRuntime.orderId,
      liveMarket?.slug ?? null,
    );

    executionRuntime = await this.updateExecutionRuntime(qmonEngine, population.market, {
      pendingVenueOrders: marketPendingVenueOrders,
      lastReconciledAt: now,
    }, now);
    executionRuntime = await this.reconcileTrackedOrder(qmonEngine, population.market, executionRuntime, marketPendingVenueOrders, liveMarket);
    currentPopulation = qmonEngine.getPopulation(population.market) ?? currentPopulation;

    const reconciledSeatDriftRuntime = await this.reconcileRecoverableSeatDrift(
      qmonEngine,
      population.market,
      currentPopulation,
      executionRuntime,
    );

    if (reconciledSeatDriftRuntime !== null) {
      executionRuntime = reconciledSeatDriftRuntime;
      currentPopulation = qmonEngine.getPopulation(population.market) ?? currentPopulation;
    }

    if (this.shouldResetWindowScopedRuntime(currentPopulation, executionRuntime, currentWindowStartMs)) {
      executionRuntime = await this.updateExecutionRuntime(qmonEngine, population.market, {
        pendingIntent: null,
        orderId: null,
        submittedAt: null,
        pendingVenueOrders: [],
        isHalted: false,
        recoveryStartedAt: null,
        lastError: null,
      }, now);
      this.logLiveExecutionEvent("live-window-reset", population.market, `cleared window-scoped execution block for new window start=${currentWindowStartMs}`);
      currentPopulation = qmonEngine.getPopulation(population.market) ?? currentPopulation;
    }

    if (this.hasLiveSeatDivergence(currentPopulation, executionRuntime)) {
      const shouldLogDivergence = executionRuntime.lastError !== "live seat divergence detected between venue state and local seat ledger" || !executionRuntime.isHalted;

      executionRuntime = await this.updateExecutionRuntime(qmonEngine, population.market, {
        submittedAt: executionRuntime.submittedAt ?? now,
        isHalted: true,
        recoveryStartedAt: null,
        lastError: "live seat divergence detected between venue state and local seat ledger",
      }, Date.now());

      if (shouldLogDivergence) {
        this.logLiveWarning(population.market, "live-routing-halted", executionRuntime.lastError ?? "live seat divergence");
      }

      return;
    }

    if (executionRuntime.isHalted) {
      return;
    }

    if (currentPopulation.seatPendingOrder === null) {
      if (executionRuntime.pendingIntent !== null && executionRuntime.orderId === null) {
        await this.updateExecutionRuntime(qmonEngine, population.market, {
          pendingIntent: null,
        }, Date.now());
      }

      return;
    }

    if (this.shouldBlockFreshEntryForCurrentWindow(executionRuntime, currentPopulation.seatPendingOrder, currentWindowStartMs)) {
      qmonEngine.clearRealSeatPendingOrder(population.market, now);
      return;
    }

    if (this.hasPendingOrderExpired(currentPopulation.seatPendingOrder)) {
      qmonEngine.clearRealSeatPendingOrder(population.market, Date.now());
      await this.updateExecutionRuntime(qmonEngine, population.market, {
        pendingIntent: null,
        lastError: "live-order-expired",
      }, Date.now());
      this.logLiveWarning(population.market, "live-order-expired", "real seat order expired before live execution");
      return;
    }

    if (executionRuntime.orderId !== null || executionRuntime.pendingVenueOrders.length > 0) {
      return;
    }

    if (liveMarket === null) {
      liveMarket = await this.resolveLiveMarket(population.market, latestSignals);
    }

    if (liveMarket === null) {
      await this.updateExecutionRuntime(qmonEngine, population.market, {
        lastError: "live-market-resolution-failed",
      }, Date.now());
      return;
    }

    await this.updateExecutionRuntime(qmonEngine, population.market, {
      pendingIntent: currentPopulation.seatPendingOrder,
      isHalted: false,
      recoveryStartedAt: null,
      lastError: null,
    }, Date.now());
    await this.processPendingSeatOrder(qmonEngine, currentPopulation, currentPopulation.seatPendingOrder, liveMarket);
  }

  private async reconcileTrackedOrder(
    qmonEngine: QmonEngine,
    market: MarketKey,
    executionRuntime: QmonExecutionRuntime,
    marketPendingVenueOrders: readonly QmonPendingVenueOrderSnapshot[],
    liveMarket: PolymarketMarket | null,
  ): Promise<QmonExecutionRuntime> {
    const now = Date.now();

    if (executionRuntime.orderId === null) {
      return executionRuntime;
    }

    if (marketPendingVenueOrders.some((pendingVenueOrder) => pendingVenueOrder.orderId === executionRuntime.orderId)) {
      if (executionRuntime.pendingIntent !== null && this.hasPendingOrderExpired(executionRuntime.pendingIntent)) {
        const shouldCancelTrackedOrder = executionRuntime.pendingIntent.marketEndMs !== null && Date.now() >= executionRuntime.pendingIntent.marketEndMs;

        if (shouldCancelTrackedOrder) {
          try {
            const wasCancelled = await this.orderService.cancelOrderById(executionRuntime.orderId);

            if (wasCancelled) {
              qmonEngine.clearRealSeatPendingOrder(market, now);
              this.logLiveExecutionEvent("live-order-cancelled", market, `cancelled stale pending order id=${executionRuntime.orderId}`);

              return this.updateExecutionRuntime(qmonEngine, market, {
                pendingIntent: null,
                orderId: null,
                pendingVenueOrders: [],
                submittedAt: executionRuntime.submittedAt ?? now,
                isHalted: true,
                recoveryStartedAt: null,
                lastError: "stale live order cancelled after market expiry",
              }, now);
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);

            this.logLiveWarning(market, "live-order-failed", `cancel stale order failed: ${message}`);
          }
        }
      }

      return this.updateExecutionRuntime(qmonEngine, market, {
        pendingVenueOrders: marketPendingVenueOrders,
        submittedAt: executionRuntime.submittedAt ?? now,
        isHalted: true,
        recoveryStartedAt: executionRuntime.recoveryStartedAt ?? now,
        lastError: executionRuntime.lastError ?? "waiting for venue confirmation",
      }, now);
    }

    if (executionRuntime.pendingIntent !== null) {
      const resolvedExecutionRuntime = await this.resolveMissingTrackedOrderTerminalState(
        qmonEngine,
        market,
        executionRuntime,
      );

      if (resolvedExecutionRuntime !== null) {
        return resolvedExecutionRuntime;
      }

      qmonEngine.clearRealSeatPendingOrder(market, now);
      this.logLiveWarning(market, "live-routing-halted", `order ${executionRuntime.orderId} disappeared without a provable terminal reconciliation`);

      return this.updateExecutionRuntime(qmonEngine, market, {
        pendingIntent: null,
        orderId: null,
        submittedAt: executionRuntime.submittedAt ?? now,
        pendingVenueOrders: [],
        isHalted: true,
        recoveryStartedAt: null,
        lastError: `order ${executionRuntime.orderId} disappeared without a provable terminal reconciliation`,
      }, now);
    }

    if (executionRuntime.confirmedVenueSeat !== null) {
      return this.updateExecutionRuntime(qmonEngine, market, {
        orderId: null,
        pendingVenueOrders: [],
        isHalted: false,
        recoveryStartedAt: null,
        lastError: null,
      }, now);
    }

    return this.updateExecutionRuntime(qmonEngine, market, {
      orderId: null,
      pendingVenueOrders: [],
      isHalted: false,
      recoveryStartedAt: null,
      lastError: null,
    }, now);
  }

  private async resolveMissingTrackedOrderTerminalState(
    qmonEngine: QmonEngine,
    market: MarketKey,
    executionRuntime: QmonExecutionRuntime,
  ): Promise<QmonExecutionRuntime | null> {
    const pendingIntent = executionRuntime.pendingIntent;
    let resolvedExecutionRuntime: QmonExecutionRuntime | null = null;

    if (pendingIntent !== null && executionRuntime.orderId !== null) {
      this.logLiveExecutionEvent(
        "live-reconcile-started",
        market,
        `reconciling orderId=${executionRuntime.orderId} kind=${pendingIntent.kind} action=${pendingIntent.action}`,
      );
      const reconciliationStatus = await this.orderService.reconcileOrderStatus({
        orderId: executionRuntime.orderId,
        shouldCancelOnPending: false,
        maxAttempts: 1,
        retryDelayMs: 1,
      });

      if (reconciliationStatus === "confirmed") {
        const marketMetadata = this.liveMarketCacheByMarket.get(market)?.market ?? null;
        const venuePositionShareCount =
          marketMetadata !== null && pendingIntent.kind === "entry"
            ? await this.getVenueSellableSize(marketMetadata, pendingIntent)
            : null;

        this.logLiveExecutionEvent(
          "live-reconcile-confirmed",
          market,
          `reconciliation confirmed orderId=${executionRuntime.orderId}`,
        );
        qmonEngine.applyRealSeatPendingOrderFill(market, pendingIntent.limitPrice, pendingIntent.requestedShares, Date.now(), venuePositionShareCount);
        await this.refreshBalanceSnapshot();

        const updatedPopulation = qmonEngine.getPopulation(market);
        const confirmedVenueSeat = this.createConfirmedVenueSeatFromPopulation(updatedPopulation);

        resolvedExecutionRuntime = await this.updateExecutionRuntime(qmonEngine, market, {
          pendingIntent: null,
          orderId: null,
          submittedAt: null,
          confirmedVenueSeat,
          pendingVenueOrders: [],
          isHalted: false,
          recoveryStartedAt: null,
          lastError: null,
          lastReconciledAt: Date.now(),
        }, Date.now());
      } else if (reconciliationStatus === "cancelled" || reconciliationStatus === "failed") {
        const errorMessage = `live order ${reconciliationStatus}`;

        this.logLiveExecutionEvent(
          "live-reconcile-failed",
          market,
          `reconciliation resolved orderId=${executionRuntime.orderId} status=${reconciliationStatus}`,
        );
        qmonEngine.clearRealSeatPendingOrder(market, Date.now());
        resolvedExecutionRuntime = await this.updateExecutionRuntime(qmonEngine, market, {
          pendingIntent: null,
          orderId: null,
          submittedAt: null,
          pendingVenueOrders: [],
          isHalted: false,
          recoveryStartedAt: null,
          lastError: errorMessage,
          lastReconciledAt: Date.now(),
        }, Date.now());
      } else if (reconciliationStatus === "pending") {
        this.logLiveExecutionEvent(
          "live-reconcile-pending",
          market,
          `reconciliation still pending for orderId=${executionRuntime.orderId}`,
        );
        resolvedExecutionRuntime = await this.updateExecutionRuntime(qmonEngine, market, {
          submittedAt: executionRuntime.submittedAt ?? Date.now(),
          isHalted: true,
          recoveryStartedAt: executionRuntime.recoveryStartedAt ?? Date.now(),
          lastError: executionRuntime.lastError ?? "waiting for venue confirmation",
          lastReconciledAt: Date.now(),
        }, Date.now());
      }
    }

    return resolvedExecutionRuntime;
  }

  private getBelowMinimumOrderSizeError(pendingOrder: QmonPendingOrder, market: PolymarketMarket): string | null {
    const minimumOrderSize = market.orderMinSize;
    let errorMessage: string | null = null;

    if (typeof minimumOrderSize === "number" && minimumOrderSize > 0 && pendingOrder.requestedShares < minimumOrderSize) {
      errorMessage =
        `live order below market minimum size: requested=${pendingOrder.requestedShares.toFixed(4)} minimum=${minimumOrderSize.toFixed(4)}`;
    }

    return errorMessage;
  }

  private shouldClearConfirmedExitDust(population: QmonPopulation | null, pendingOrder: QmonPendingOrder, market: PolymarketMarket): boolean {
    const seatShareCount = population?.seatPosition.shareCount ?? null;
    let shouldClearDust = false;

    if (pendingOrder.kind === "exit" && seatShareCount !== null && seatShareCount > 0) {
      shouldClearDust = seatShareCount < market.orderMinSize;
    }

    return shouldClearDust;
  }

  private async processPendingSeatOrder(
    qmonEngine: QmonEngine,
    population: QmonPopulation,
    pendingOrder: QmonPendingOrder,
    market: PolymarketMarket,
  ): Promise<void> {
    const marketKey = population.market;
    const pendingIntentKey = this.buildPendingIntentKey(pendingOrder);

    await this.updateExecutionRuntime(qmonEngine, marketKey, {
      pendingIntent: pendingOrder,
      submittedAt: Date.now(),
      orderId: null,
      pendingVenueOrders: [],
      isHalted: false,
      recoveryStartedAt: null,
      lastError: null,
    }, Date.now());
    this.logLiveExecutionEvent(
      "live-sync-attempt",
      marketKey,
      `attempt kind=${pendingOrder.kind} action=${pendingOrder.action} shares=${pendingOrder.requestedShares.toFixed(4)} price=${pendingOrder.limitPrice.toFixed(4)} key=${pendingIntentKey}`,
    );
    const belowMinimumOrderSizeError = this.getBelowMinimumOrderSizeError(pendingOrder, market);

    if (belowMinimumOrderSizeError !== null) {
      await this.updateExecutionRuntime(qmonEngine, marketKey, {
        pendingIntent: pendingOrder,
        submittedAt: Date.now(),
        isHalted: true,
        recoveryStartedAt: null,
        lastError: belowMinimumOrderSizeError,
        lastReconciledAt: Date.now(),
      }, Date.now());
      this.logLiveWarning(marketKey, "live-routing-halted", belowMinimumOrderSizeError);
      return;
    }

    const attemptResult = await this.postAndConfirmOrder(market, marketKey, pendingOrder);
    const confirmation = attemptResult.confirmation;
    const executedPrice = confirmation?.price ?? pendingOrder.limitPrice;
    const executedSize = confirmation?.size ?? pendingOrder.requestedShares;
    const hasTraceableOrderId = attemptResult.orderId !== null && attemptResult.orderId.trim().length > 0;

    if (confirmation !== null && confirmation.ok && confirmation.status === "confirmed") {
      if (!hasTraceableOrderId) {
        qmonEngine.clearRealSeatPendingOrder(marketKey, Date.now());
        await this.updateExecutionRuntime(qmonEngine, marketKey, {
          pendingIntent: pendingOrder,
          submittedAt: Date.now(),
          isHalted: true,
          recoveryStartedAt: null,
          lastError: "confirmed live order missing traceable orderId",
        }, Date.now());
        this.logLiveWarning(marketKey, "live-routing-halted", "confirmed live order missing traceable orderId");
        return;
      }

      qmonEngine.applyRealSeatPendingOrderFill(marketKey, executedPrice, executedSize, Date.now());
      await this.refreshBalanceSnapshot();

      let updatedPopulation = qmonEngine.getPopulation(marketKey);

      if (this.shouldClearConfirmedExitDust(updatedPopulation, pendingOrder, market)) {
        const residualShareCount = updatedPopulation?.seatPosition.shareCount ?? 0;

        qmonEngine.clearRealSeatDustPosition(marketKey, Date.now());
        updatedPopulation = qmonEngine.getPopulation(marketKey);
        this.logLiveWarning(
          marketKey,
          "live-seat-dust-cleared",
          `cleared residual seat shares below venue minimum after confirmed exit: remaining=${residualShareCount.toFixed(4)} minimum=${market.orderMinSize.toFixed(4)}`,
        );
      }

      const confirmedVenueSeat = this.createConfirmedVenueSeatFromPopulation(updatedPopulation);

      await this.updateExecutionRuntime(qmonEngine, marketKey, {
        pendingIntent: null,
        orderId: null,
        submittedAt: null,
        confirmedVenueSeat,
        pendingVenueOrders: [],
        isHalted: false,
        recoveryStartedAt: null,
        lastError: null,
        lastReconciledAt: Date.now(),
      }, Date.now());

      updatedPopulation = qmonEngine.getPopulation(marketKey);

      if (updatedPopulation !== null && this.hasLiveSeatDivergence(updatedPopulation, this.getExecutionRuntime(updatedPopulation, "real"))) {
        await this.updateExecutionRuntime(qmonEngine, marketKey, {
          submittedAt: Date.now(),
          isHalted: true,
          recoveryStartedAt: null,
          lastError: "confirmed live order did not reconcile cleanly with local seat state",
        }, Date.now());
        this.logLiveWarning(marketKey, "live-routing-halted", "confirmed live order did not reconcile cleanly with local seat state");
      }

      return;
    }

    const errorMessage = attemptResult.errorMessage ?? confirmation?.error?.message ?? (confirmation !== null ? `live order ${confirmation.status}` : "live order failed");

    if (attemptResult.orderId !== null) {
      await this.updateExecutionRuntime(qmonEngine, marketKey, {
        pendingIntent: pendingOrder,
        orderId: attemptResult.orderId,
        submittedAt: Date.now(),
        isHalted: true,
        recoveryStartedAt: Date.now(),
        lastError: errorMessage,
      }, Date.now());
      this.logLiveWarning(marketKey, "live-recovery-required", errorMessage);
      return;
    }

    if (this.isBalanceError(errorMessage)) {
      qmonEngine.clearRealSeatPendingOrder(marketKey, Date.now());
      this.balanceSnapshot = {
        ...this.balanceSnapshot,
        balanceState: "stale",
      };
      await this.refreshBalanceSnapshot();

      await this.updateExecutionRuntime(qmonEngine, marketKey, {
        pendingIntent: null,
        orderId: null,
        submittedAt: null,
        pendingVenueOrders: [],
        lastError: errorMessage,
        isHalted: false,
        recoveryStartedAt: null,
      }, Date.now());
      this.logLiveWarning(marketKey, "live-order-failed", errorMessage);
      return;
    }

    if (errorMessage.includes("traceable orderId") || errorMessage.includes("without id")) {
      await this.updateExecutionRuntime(qmonEngine, marketKey, {
        pendingIntent: pendingOrder,
        submittedAt: Date.now(),
        isHalted: true,
        recoveryStartedAt: null,
        lastError: errorMessage,
      }, Date.now());
      this.logLiveWarning(marketKey, "live-routing-halted", errorMessage);
      return;
    }

    qmonEngine.clearRealSeatPendingOrder(marketKey, Date.now());
    await this.updateExecutionRuntime(qmonEngine, marketKey, {
      pendingIntent: null,
      orderId: null,
      submittedAt: Date.now(),
      pendingVenueOrders: [],
      lastError: errorMessage,
      isHalted: false,
      recoveryStartedAt: null,
      lastReconciledAt: Date.now(),
    }, Date.now());
    this.logLiveWarning(marketKey, "live-order-failed", errorMessage);
  }

  private async postAndConfirmOrder(
    market: PolymarketMarket,
    marketKey: MarketKey,
    pendingOrder: QmonPendingOrder,
  ): Promise<LiveOrderAttemptResult> {
    const direction = pendingOrder.action === "BUY_DOWN" || pendingOrder.action === "SELL_DOWN" ? "down" : "up";
    const op = pendingOrder.kind === "entry" ? "buy" : "sell";
    const size = pendingOrder.requestedShares;
    const price = pendingOrder.limitPrice;
    let liveOrderAttemptResult: LiveOrderAttemptResult = {
      confirmation: null,
      errorMessage: null,
      orderId: null,
    };

    try {
      const postedOrder = await this.orderService.postOrder({
        market,
        size,
        price,
        op,
        direction,
        executionType: "taker",
        paperMode: false,
      });

      if (postedOrder === null) {
        liveOrderAttemptResult = {
          confirmation: null,
          errorMessage: "OrderService.postOrder returned null",
          orderId: null,
        };
      } else {
        const postedOrderId = typeof postedOrder.id === "string" && postedOrder.id.trim().length > 0 ? postedOrder.id : null;

        if (postedOrderId === null) {
          liveOrderAttemptResult = {
            confirmation: null,
            errorMessage: "OrderService.postOrder returned an order without id",
            orderId: null,
          };

          return liveOrderAttemptResult;
        }

        this.logLiveExecutionEvent(
          "live-order-posted",
          marketKey,
          `posted ${op} ${direction} ${postedOrder.size.toFixed(2)} @ ${postedOrder.price.toFixed(4)} id=${postedOrderId}`,
        );
        const confirmation = await this.orderService.waitForOrderConfirmation({
          order: postedOrder,
          timeoutMs: this.confirmationTimeoutMs,
          shouldCancelOnTimeout: false,
        });

        if (confirmation.ok && confirmation.status === "confirmed") {
          this.logLiveExecutionEvent(
            "live-order-confirmed",
            marketKey,
            `confirmed ${op} ${direction} ${confirmation.size.toFixed(2)} @ ${confirmation.price.toFixed(4)} id=${postedOrderId}`,
          );
        }

        liveOrderAttemptResult = {
          confirmation,
          errorMessage: confirmation.ok ? null : confirmation.error?.message ?? `live order ${confirmation.status}`,
          orderId: postedOrderId,
        };
      }
    } catch (error: unknown) {
      const message = this.buildLiveOrderErrorMessage(error, market.slug, op, direction, size, price);

      liveOrderAttemptResult = {
        confirmation: null,
        errorMessage: message,
        orderId: null,
      };
      logger.error(message);
      this.logLiveWarning(marketKey, "live-order-threw", message);
    }

    return liveOrderAttemptResult;
  }

  private getPendingOrderDirection(pendingOrder: QmonPendingOrder): "up" | "down" {
    const direction = pendingOrder.action === "BUY_DOWN" || pendingOrder.action === "SELL_DOWN" ? "down" : "up";

    return direction;
  }

  private async getVenueSellableSize(market: PolymarketMarket, pendingOrder: QmonPendingOrder): Promise<number | null> {
    const direction = this.getPendingOrderDirection(pendingOrder);
    let sellableSize: number | null = null;

    try {
      sellableSize = await this.orderService.getSellableSize({
        market,
        direction,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logLiveWarning(pendingOrder.market, "live-balance-refresh-failed", `could not read sellable size after entry confirmation: ${message}`);
    }

    return sellableSize;
  }

  private async listActiveOrdersPendingConfirmation(): Promise<readonly PendingConfirmationOrder[]> {
    let pendingConfirmationOrders: readonly PendingConfirmationOrder[] = [];

    try {
      pendingConfirmationOrders = await this.orderService.listActiveOrdersPendingConfirmation();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logLiveWarning("system", "live-order-failed", `pending confirmation scan failed: ${message}`);
    }

    return pendingConfirmationOrders;
  }

  private asString(value: unknown): string | null {
    let textValue: string | null = null;

    if (typeof value === "string" && value.trim().length > 0) {
      textValue = value;
    }

    return textValue;
  }

  private asNumber(value: unknown): number | null {
    let numericValue: number | null = null;

    if (typeof value === "number" && Number.isFinite(value)) {
      numericValue = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      const parsedNumber = Number(value);

      if (Number.isFinite(parsedNumber)) {
        numericValue = parsedNumber;
      }
    }

    return numericValue;
  }

  private buildPendingVenueOrderSnapshot(pendingConfirmationOrder: PendingConfirmationOrder): QmonPendingVenueOrderSnapshot {
    const orderRecord = pendingConfirmationOrder as unknown as Record<string, unknown>;
    const rawSide = this.asString(orderRecord.side);
    const rawOutcome = this.asString(orderRecord.outcome);
    let side: QmonPendingVenueOrderSnapshot["side"] = null;
    let outcome: QmonPendingVenueOrderSnapshot["outcome"] = null;

    if (rawSide === "buy" || rawSide === "sell") {
      side = rawSide;
    }

    if (rawOutcome === "up" || rawOutcome === "down") {
      outcome = rawOutcome;
    }

    return {
      orderId: this.asString(orderRecord.id) ?? "unknown-order",
      marketSlug: this.asString(orderRecord.marketSlug) ?? this.asString(orderRecord.market) ?? this.asString(orderRecord.slug),
      side,
      outcome,
      size: this.asNumber(orderRecord.size) ?? this.asNumber(orderRecord.remainingSize) ?? this.asNumber(orderRecord.original_size),
      price: this.asNumber(orderRecord.price),
      status: this.asString(orderRecord.status),
      createdAt: this.asNumber(orderRecord.createdAt) ?? this.asNumber(orderRecord.created_at),
    };
  }

  private filterPendingVenueOrdersForMarket(
    pendingVenueOrders: readonly PendingConfirmationOrder[],
    trackedOrderId: string | null,
    marketSlug: string | null,
  ): readonly QmonPendingVenueOrderSnapshot[] {
    const marketPendingVenueOrders = pendingVenueOrders
      .map((pendingVenueOrder) => this.buildPendingVenueOrderSnapshot(pendingVenueOrder))
      .filter((pendingVenueOrder) => {
        const isTrackedOrder = trackedOrderId !== null && pendingVenueOrder.orderId === trackedOrderId;
        const isMatchingSlug = marketSlug !== null && pendingVenueOrder.marketSlug === marketSlug;

        return isTrackedOrder || isMatchingSlug;
      });

    return marketPendingVenueOrders;
  }

  private buildLiveOrderErrorMessage(
    error: unknown,
    marketSlug: string,
    op: "buy" | "sell",
    direction: "up" | "down",
    size: number,
    price: number,
  ): string {
    const errorDetails = this.describeUnknownError(error);

    return `Failed to post order for market=${marketSlug} op=${op} direction=${direction} size=${size.toFixed(4)} price=${price.toFixed(4)}. ${errorDetails}`;
  }

  private describeUnknownError(error: unknown): string {
    let errorDetails = String(error);

    if (error instanceof Error) {
      const errorCause =
        error.cause instanceof Error
          ? `${error.cause.name}: ${error.cause.message}`
          : error.cause !== undefined
            ? String(error.cause)
            : null;
      const errorStack = error.stack?.split("\n").slice(0, 3).join(" | ") ?? null;

      errorDetails = `${error.name}: ${error.message}`;

      if (errorCause !== null) {
        errorDetails = `${errorDetails} cause=${errorCause}`;
      }

      if (errorStack !== null) {
        errorDetails = `${errorDetails} stack=${errorStack}`;
      }
    }

    return errorDetails;
  }

  private async refreshBalanceSnapshot(): Promise<void> {
    let nextBalanceSnapshot: LiveBalanceSnapshot = this.balanceSnapshot;

    try {
      const balanceUsd = await this.orderService.getMyBalance();

      nextBalanceSnapshot = {
        balanceUsd,
        balanceState: "fresh",
        balanceUpdatedAt: Date.now(),
      };
      this.logLiveExecutionEvent("live-balance-refreshed", null, `available balance ${balanceUsd.toFixed(2)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      nextBalanceSnapshot = {
        balanceUsd: this.balanceSnapshot.balanceUsd,
        balanceState: this.balanceSnapshot.balanceUsd === null ? "unavailable" : "stale",
        balanceUpdatedAt: this.balanceSnapshot.balanceUpdatedAt,
      };
      this.logLiveWarning("system", "live-balance-refresh-failed", message);
    }

    this.balanceSnapshot = nextBalanceSnapshot;
  }

  private async resolveLiveMarket(marketKey: MarketKey, latestSignals: StructuredSignalResult): Promise<PolymarketMarket | null> {
    const [asset, window] = marketKey.split("-");
    const assetSignals = asset ? latestSignals[asset] : null;
    const windowSignals = assetSignals?.windows?.[window ?? ""] ?? null;
    const windowStartMs = windowSignals?.prices?.marketStartMs ?? null;
    const cachedLiveMarket = this.liveMarketCacheByMarket.get(marketKey) ?? null;
    let liveMarket = cachedLiveMarket?.market ?? null;

    if (cachedLiveMarket === null || cachedLiveMarket.windowStartMs !== windowStartMs) {
      try {
        const liveMarkets = await this.marketCatalogService.loadCryptoWindowMarkets({
          date: new Date(),
          window: window as CryptoMarketWindow,
          symbols: [asset as CryptoSymbol],
        });
        const now = Date.now();
        const activeLiveMarket =
          liveMarkets.find((candidateMarket) => candidateMarket.start.getTime() <= now && candidateMarket.end.getTime() >= now) ?? liveMarkets[0] ?? null;

        if (activeLiveMarket !== null) {
          this.liveMarketCacheByMarket.set(marketKey, {
            market: activeLiveMarket,
            windowStartMs,
          });
          liveMarket = activeLiveMarket;
          this.logLiveExecutionEvent("live-market-resolved", marketKey, activeLiveMarket.slug);
        } else {
          this.logLiveWarning(marketKey, "live-market-resolution-failed", `no active Polymarket market found for ${marketKey}`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this.logLiveWarning(marketKey, "live-market-resolution-failed", message);
      }
    }

    return liveMarket;
  }

  private hasPendingOrderExpired(pendingOrder: QmonPendingOrder): boolean {
    let isExpired = false;

    if (pendingOrder.marketEndMs !== null) {
      isExpired = Date.now() >= pendingOrder.marketEndMs;
    }

    return isExpired;
  }

  private isBalanceError(message: string): boolean {
    const normalizedMessage = message.toLowerCase();
    let isBalanceError = false;

    for (const errorPattern of BALANCE_ERROR_PATTERNS) {
      if (normalizedMessage.includes(errorPattern)) {
        isBalanceError = true;
      }
    }

    return isBalanceError;
  }

  private logLiveExecutionEvent(eventType: string, market: MarketKey | null, detail: string): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logLiveExecutionEvent(
        {
          market,
          details: detail,
          isSeat: true,
        },
        eventType,
      );
    }

    if (REAL_ACTIVITY_EVENT_TYPES.has(eventType)) {
      logger.warn(this.buildRealActivityLogLine(eventType, market, detail));
    }
  }

  private logLiveWarning(market: MarketKey | "system", warningCode: string, details: string): void {
    if (this.validationLogService !== null) {
      this.validationLogService.logValidationWarning({
        market: market === "system" ? null : market,
        warningCode,
        details,
        isSeat: market !== "system",
      });
    }

    if (REAL_ACTIVITY_WARNING_CODES.has(warningCode)) {
      logger.warn(this.buildRealActivityLogLine(warningCode, market === "system" ? null : market, details));
    }
  }

  private buildRealActivityLogLine(activityCode: string, market: MarketKey | null, details: string): string {
    const marketLabel = market ?? "system";

    return `[real-activity] code=${activityCode} market=${marketLabel} ${details}`;
  }
}
