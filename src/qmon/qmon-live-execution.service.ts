/**
 * @section imports:externals
 */

import { MarketCatalogService, OrderService } from "@sha3/polymarket";
import polymarketConfig from "@sha3/polymarket/dist/config.js";
import type { CryptoMarketWindow, CryptoSymbol, PolymarketMarket, PostedOrderWithStatus } from "@sha3/polymarket";
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
  MarketExecutionState,
  RuntimeExecutionStatus,
} from "../app/app-runtime.types.ts";
import type { StructuredSignalResult } from "../signal/signal.types.ts";
import config from "../config.ts";
import type { MarketKey, QmonPendingOrder, QmonPopulation, TradingAction } from "./qmon.types.ts";
import type { QmonEngine } from "./qmon-engine.service.ts";
import { QmonLiveStatePersistenceService } from "./qmon-live-state-persistence.service.ts";
import type { PersistedLiveExecutionState, PersistedLiveSeatState } from "./qmon-live-state-persistence.service.ts";
import type { QmonValidationLogService } from "./qmon-validation-log.service.ts";

/**
 * @section consts
 */

const BALANCE_ERROR_PATTERNS = ["balance", "allowance", "insufficient"];
const EMPTY_ALLOWLIST: readonly MarketKey[] = [];
const MAX_ATTEMPTS_PER_5M = 3;
const MAX_FAILURES_PER_15M = 5;
const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const REAL_ACTIVITY_EVENT_TYPES = new Set(["live-order-posted", "live-order-confirmed"]);
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

type LivePositionState = {
  readonly action: TradingAction;
  readonly shareCount: number;
  readonly entryPrice: number | null;
  readonly enteredAt: number;
};

type LiveMarketRouteState = "armed" | "halted" | "recovery-required";

type LiveMarketState = {
  readonly routeState: LiveMarketRouteState;
  readonly executionState: MarketExecutionState;
  readonly isHalted: boolean;
  readonly pendingIntentKey: string | null;
  readonly submittedAt: number | null;
  readonly orderId: string | null;
  readonly livePosition: LivePositionState | null;
  readonly attemptTimestamps: readonly number[];
  readonly failureTimestamps: readonly number[];
  readonly lastError: string | null;
};

type InitializeLiveExecutionOptions = {
  readonly mode: ExecutionMode;
  readonly allowlistedMarkets: readonly MarketKey[];
  readonly privateKey?: string;
  readonly funderAddress?: string;
  readonly signatureType?: SignatureType;
  readonly maxAllowedSlippage?: number;
  readonly confirmationTimeoutMs: number;
  readonly persistedState: PersistedLiveExecutionState | null;
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
  private allowlistedMarkets: readonly MarketKey[];
  private confirmationTimeoutMs: number;
  private cpnlSessionStartedAt: number | null;
  private balanceSnapshot: LiveBalanceSnapshot;
  private readonly liveMarketCacheByMarket: Map<MarketKey, LiveMarketCache>;
  private readonly liveMarketStateByMarket: Map<MarketKey, LiveMarketState>;
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
    this.allowlistedMarkets = EMPTY_ALLOWLIST;
    this.confirmationTimeoutMs = 15_000;
    this.cpnlSessionStartedAt = null;
    this.balanceSnapshot = {
      balanceUsd: null,
      balanceState: "unavailable",
      balanceUpdatedAt: null,
    };
    this.liveMarketCacheByMarket = new Map();
    this.liveMarketStateByMarket = new Map();
    this.isInitialized = false;
    this.syncQueue = Promise.resolve();
  }

  /**
   * @section public:methods
   */

  public async initialize(options: InitializeLiveExecutionOptions): Promise<void> {
    this.mode = options.mode;
    this.allowlistedMarkets = [...options.allowlistedMarkets];
    this.confirmationTimeoutMs = options.confirmationTimeoutMs;
    this.cpnlSessionStartedAt = options.cpnlSessionStartedAt;
    this.applyPolymarketSafetyConfig();
    this.restorePersistedMarketState(options.persistedState);

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
      await this.persistLiveState();
    }
  }

  /**
   * Apply local venue safety overrides before the order service starts trading.
   */
  private applyPolymarketSafetyConfig(): void {
    const mutablePolymarketConfig = polymarketConfig as { SAFE_MAX_BUY_AMOUNT: number };

    mutablePolymarketConfig.SAFE_MAX_BUY_AMOUNT = config.POLYMARKET_SAFE_MAX_BUY_AMOUNT;
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
      const market = population.market;
      const liveMarketState = this.getMarketState(market);
      const hasRealRouting = this.mode === "real" && this.allowlistedMarkets.includes(market);
      const confirmedLiveSeat = hasRealRouting ? this.buildConfirmedLiveSeatSummary(liveMarketState.livePosition) : null;
      const marketExecutionRoute: MarketExecutionRoute = {
        market,
        route: hasRealRouting ? "real" : "paper",
        executionState: hasRealRouting ? liveMarketState.executionState : "paper",
        isHalted: hasRealRouting ? liveMarketState.isHalted : false,
        hasPendingIntent: hasRealRouting ? liveMarketState.pendingIntentKey !== null : false,
        pendingIntentKey: hasRealRouting ? liveMarketState.pendingIntentKey : null,
        hasLivePosition: confirmedLiveSeat !== null,
        livePositionAction: confirmedLiveSeat?.action ?? null,
        confirmedLiveSeat,
        lastError: hasRealRouting ? liveMarketState.lastError : null,
      };

      marketRoutes.push(marketExecutionRoute);
    }

    return {
      mode: this.mode,
      allowlistedMarkets: [...this.allowlistedMarkets],
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

  private createDefaultMarketState(): LiveMarketState {
    const liveMarketState: LiveMarketState = {
      routeState: "armed",
      executionState: "real-armed",
      isHalted: false,
      pendingIntentKey: null,
      submittedAt: null,
      orderId: null,
      livePosition: null,
      attemptTimestamps: [],
      failureTimestamps: [],
      lastError: null,
    };

    return liveMarketState;
  }

  private getMarketState(market: MarketKey): LiveMarketState {
    const currentMarketState = this.liveMarketStateByMarket.get(market) ?? null;
    const liveMarketState = currentMarketState ?? this.createDefaultMarketState();

    if (currentMarketState === null) {
      this.liveMarketStateByMarket.set(market, liveMarketState);
    }

    return liveMarketState;
  }

  private async setMarketState(
    market: MarketKey,
    nextMarketState: LiveMarketState,
    shouldPersist = true,
  ): Promise<void> {
    this.liveMarketStateByMarket.set(market, nextMarketState);

    if (shouldPersist) {
      await this.persistLiveState();
    }
  }

  private buildConfirmedLiveSeatSummary(livePosition: LivePositionState | null): ConfirmedLiveSeatSummary | null {
    let confirmedLiveSeatSummary: ConfirmedLiveSeatSummary | null = null;

    if (livePosition !== null) {
      confirmedLiveSeatSummary = {
        action: livePosition.action,
        shareCount: livePosition.shareCount,
        entryPrice: livePosition.entryPrice,
        enteredAt: livePosition.enteredAt,
      };
    }

    return confirmedLiveSeatSummary;
  }

  private buildPersistedLiveSeat(livePosition: LivePositionState | null): PersistedLiveSeatState | null {
    let persistedLiveSeat: PersistedLiveSeatState | null = null;

    if (livePosition !== null) {
      persistedLiveSeat = {
        action: livePosition.action,
        shareCount: livePosition.shareCount,
        entryPrice: livePosition.entryPrice,
        enteredAt: livePosition.enteredAt,
      };
    }

    return persistedLiveSeat;
  }

  private buildPendingIntentKey(pendingOrder: QmonPendingOrder): string {
    const pendingIntentKey = [
      pendingOrder.market,
      pendingOrder.kind,
      pendingOrder.action,
      pendingOrder.createdAt,
      pendingOrder.requestedShares.toFixed(6),
      pendingOrder.limitPrice.toFixed(6),
    ].join(":");

    return pendingIntentKey;
  }

  private restorePersistedMarketState(persistedState: PersistedLiveExecutionState | null): void {
    if (persistedState !== null) {
      for (const persistedMarketState of persistedState.markets) {
        const routeState = persistedMarketState.routeState;
        const livePosition = persistedMarketState.confirmedLiveSeat;
        const restoredMarketState: LiveMarketState = {
          routeState,
          executionState:
            routeState === "halted"
              ? "real-halted"
              : routeState === "recovery-required"
                ? "real-recovery-required"
                : livePosition !== null
                  ? "real-open"
                  : "real-armed",
          isHalted: routeState !== "armed",
          pendingIntentKey: persistedMarketState.pendingIntentKey,
          submittedAt: persistedMarketState.submittedAt,
          orderId: persistedMarketState.orderId,
          livePosition:
            livePosition !== null
              ? {
                  action: livePosition.action,
                  shareCount: livePosition.shareCount,
                  entryPrice: livePosition.entryPrice,
                  enteredAt: livePosition.enteredAt,
                }
              : null,
          attemptTimestamps: [],
          failureTimestamps: [],
          lastError: persistedMarketState.lastError,
        };

        this.liveMarketStateByMarket.set(persistedMarketState.market, restoredMarketState);
      }
    }
  }

  private buildPersistedState(): PersistedLiveExecutionState {
    const markets = [...this.liveMarketStateByMarket.entries()].map(([market, liveMarketState]) => ({
      market,
      routeState: liveMarketState.routeState,
      pendingIntentKey: liveMarketState.pendingIntentKey,
      submittedAt: liveMarketState.submittedAt,
      orderId: liveMarketState.orderId,
      confirmedLiveSeat: this.buildPersistedLiveSeat(liveMarketState.livePosition),
      lastError: liveMarketState.lastError,
    }));
    const persistedLiveExecutionState: PersistedLiveExecutionState = {
      updatedAt: Date.now(),
      markets,
    };

    return persistedLiveExecutionState;
  }

  private async persistLiveState(): Promise<void> {
    await this.liveStatePersistenceService.save(this.buildPersistedState());
  }

  private createLivePositionStateFromPopulation(population: QmonPopulation | null): LivePositionState | null {
    const seatPosition = population?.seatPosition ?? null;
    let livePosition: LivePositionState | null = null;

    if (seatPosition !== null && seatPosition.action !== null && seatPosition.shareCount !== null && seatPosition.enteredAt !== null) {
      livePosition = {
        action: seatPosition.action,
        shareCount: seatPosition.shareCount,
        entryPrice: seatPosition.entryPrice,
        enteredAt: seatPosition.enteredAt,
      };
    }

    return livePosition;
  }

  private resolveExecutionState(
    routeState: LiveMarketRouteState,
    population: QmonPopulation | null,
    livePosition: LivePositionState | null,
    lastError: string | null,
  ): MarketExecutionState {
    let executionState: MarketExecutionState = "real-armed";

    if (routeState === "halted") {
      executionState = "real-halted";
    } else if (routeState === "recovery-required") {
      executionState = "real-recovery-required";
    } else if (population?.seatPendingOrder?.kind === "entry") {
      executionState = "real-pending-entry";
    } else if (population?.seatPendingOrder?.kind === "exit") {
      executionState = "real-pending-exit";
    } else if (livePosition !== null) {
      executionState = "real-open";
    } else if (lastError !== null) {
      executionState = "real-error";
    }

    return executionState;
  }

  private async setMarketStateFromPopulation(population: QmonPopulation | null, lastError: string | null, marketKey?: MarketKey): Promise<void> {
    const resolvedMarketKey = population?.market ?? marketKey ?? null;

    if (resolvedMarketKey !== null) {
      const currentMarketState = this.getMarketState(resolvedMarketKey);
      const hasPendingOrder = population?.seatPendingOrder !== null && population?.seatPendingOrder !== undefined;
      const routeState = currentMarketState.routeState;
      const shouldPreserveRecoveryIntent = routeState === "recovery-required";
      const nextMarketState: LiveMarketState = {
        ...currentMarketState,
        routeState,
        isHalted: routeState !== "armed",
        pendingIntentKey: hasPendingOrder || shouldPreserveRecoveryIntent ? currentMarketState.pendingIntentKey : null,
        submittedAt: hasPendingOrder || shouldPreserveRecoveryIntent ? currentMarketState.submittedAt : null,
        orderId: hasPendingOrder || shouldPreserveRecoveryIntent ? currentMarketState.orderId : null,
        livePosition: currentMarketState.livePosition,
        lastError,
        executionState: this.resolveExecutionState(routeState, population, currentMarketState.livePosition, lastError),
      };

      await this.setMarketState(resolvedMarketKey, nextMarketState);
    }
  }

  private pruneTimestamps(timestamps: readonly number[], windowMs: number, now: number): readonly number[] {
    const prunedTimestamps = timestamps.filter((timestamp) => now - timestamp <= windowMs);

    return prunedTimestamps;
  }

  private async recordAttempt(market: MarketKey): Promise<LiveMarketState> {
    const currentMarketState = this.getMarketState(market);
    const now = Date.now();
    const nextAttemptTimestamps = [...this.pruneTimestamps(currentMarketState.attemptTimestamps, FIVE_MINUTES_MS, now), now];
    const nextMarketState: LiveMarketState = {
      ...currentMarketState,
      attemptTimestamps: nextAttemptTimestamps,
    };

    await this.setMarketState(market, nextMarketState);

    return nextMarketState;
  }

  private async recordFailure(market: MarketKey): Promise<LiveMarketState> {
    const currentMarketState = this.getMarketState(market);
    const now = Date.now();
    const nextFailureTimestamps = [...this.pruneTimestamps(currentMarketState.failureTimestamps, FIFTEEN_MINUTES_MS, now), now];
    const nextMarketState: LiveMarketState = {
      ...currentMarketState,
      failureTimestamps: nextFailureTimestamps,
    };

    await this.setMarketState(market, nextMarketState);

    return nextMarketState;
  }

  private shouldHaltForAttemptRate(marketState: LiveMarketState): boolean {
    const isAttemptRateExceeded = marketState.attemptTimestamps.length >= MAX_ATTEMPTS_PER_5M;

    return isAttemptRateExceeded;
  }

  private shouldHaltForFailureRate(marketState: LiveMarketState): boolean {
    const isFailureRateExceeded = marketState.failureTimestamps.length >= MAX_FAILURES_PER_15M;

    return isFailureRateExceeded;
  }

  private async haltMarket(qmonEngine: QmonEngine, market: MarketKey, reason: string): Promise<void> {
    const currentMarketState = this.getMarketState(market);

    qmonEngine.clearRealSeatPendingOrder(market, Date.now());
    const population = qmonEngine.getPopulation(market);
    const haltedMarketState: LiveMarketState = {
      ...currentMarketState,
      routeState: "halted",
      executionState: "real-halted",
      isHalted: true,
      pendingIntentKey: null,
      submittedAt: null,
      orderId: null,
      livePosition: this.createLivePositionStateFromPopulation(population) ?? currentMarketState.livePosition,
      lastError: reason,
    };

    await this.setMarketState(market, haltedMarketState);
    this.logLiveWarning(market, "live-routing-halted", reason);
  }

  private async enterRecoveryMarket(qmonEngine: QmonEngine, market: MarketKey, reason: string, orderId: string): Promise<void> {
    const currentMarketState = this.getMarketState(market);

    qmonEngine.clearRealSeatPendingOrder(market, Date.now());
    const recoveryMarketState: LiveMarketState = {
      ...currentMarketState,
      routeState: "recovery-required",
      executionState: "real-recovery-required",
      isHalted: true,
      pendingIntentKey: currentMarketState.pendingIntentKey,
      submittedAt: currentMarketState.submittedAt,
      orderId,
      livePosition: currentMarketState.livePosition,
      lastError: reason,
    };

    await this.setMarketState(market, recoveryMarketState);
    this.logLiveWarning(market, "live-recovery-required", reason);
  }

  private hasLiveSeatDivergence(population: QmonPopulation, liveMarketState: LiveMarketState): boolean {
    const localSeatAction = population.seatPosition.action;
    const confirmedLiveAction = liveMarketState.livePosition?.action ?? null;
    const hasConfirmedLiveAction = confirmedLiveAction !== null;
    const hasActionMismatch = hasConfirmedLiveAction && localSeatAction !== confirmedLiveAction;
    const hasUnexpectedEntryIntent = liveMarketState.livePosition !== null && population.seatPendingOrder?.kind === "entry";
    const hasUnexpectedExitIntent = liveMarketState.livePosition === null && population.seatPendingOrder?.kind === "exit";
    const hasLiveSeatDivergence = hasActionMismatch || hasUnexpectedEntryIntent || hasUnexpectedExitIntent;

    return hasLiveSeatDivergence;
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

    for (const market of this.allowlistedMarkets) {
      const population = qmonEngine.getPopulation(market);

      if (population !== null) {
        await this.syncMarket(qmonEngine, population, latestSignals);
      }
    }
  }

  private async syncMarket(qmonEngine: QmonEngine, population: QmonPopulation, latestSignals: StructuredSignalResult): Promise<void> {
    const currentMarketState = this.getMarketState(population.market);

    await this.setMarketStateFromPopulation(population, currentMarketState.lastError);

    if (this.hasLiveSeatDivergence(population, currentMarketState)) {
      this.logLiveExecutionEvent("live-sync-skip", population.market, "skip reason=seat-divergence");
      await this.haltMarket(qmonEngine, population.market, "live seat divergence detected between confirmed venue state and local seat state");
      return;
    }

    if (currentMarketState.routeState !== "armed") {
      this.logLiveExecutionEvent("live-sync-skip", population.market, `skip reason=route-state:${currentMarketState.routeState}`);
      return;
    }

    if (population.seatPendingOrder === null) {
      this.logLiveExecutionEvent("live-sync-skip", population.market, "skip reason=no-pending-order");
      return;
    }

    if (this.hasPendingOrderExpired(population.seatPendingOrder)) {
      this.logLiveExecutionEvent("live-sync-skip", population.market, "skip reason=pending-order-expired");
      qmonEngine.clearRealSeatPendingOrder(population.market, Date.now());
      await this.setMarketStateFromPopulation(qmonEngine.getPopulation(population.market), "live-order-expired");
      this.logLiveWarning(population.market, "live-order-expired", "real seat order expired before live execution");
      return;
    }

    const liveMarket = await this.resolveLiveMarket(population.market, latestSignals);

    if (liveMarket === null) {
      this.logLiveExecutionEvent("live-sync-skip", population.market, "skip reason=market-resolution-failed");
      return;
    }

    this.logLiveExecutionEvent(
      "live-sync-attempt",
      population.market,
      `attempt kind=${population.seatPendingOrder.kind} action=${population.seatPendingOrder.action} shares=${population.seatPendingOrder.requestedShares.toFixed(4)} price=${population.seatPendingOrder.limitPrice.toFixed(4)}`,
    );
    await this.processPendingSeatOrder(qmonEngine, population, population.seatPendingOrder, liveMarket);
  }

  private async processPendingSeatOrder(
    qmonEngine: QmonEngine,
    population: QmonPopulation,
    pendingOrder: QmonPendingOrder,
    market: PolymarketMarket,
  ): Promise<void> {
    const marketKey = population.market;
    const intentKey = this.buildPendingIntentKey(pendingOrder);
    const currentMarketState = this.getMarketState(marketKey);

    if (currentMarketState.pendingIntentKey === intentKey && currentMarketState.submittedAt !== null) {
      await this.haltMarket(qmonEngine, marketKey, `duplicate live intent blocked: ${intentKey}`);
      return;
    }

    const attemptedMarketState = await this.recordAttempt(marketKey);

    if (this.shouldHaltForAttemptRate(attemptedMarketState)) {
      await this.haltMarket(qmonEngine, marketKey, "live attempt rate exceeded");
      return;
    }

    const pendingMarketState: LiveMarketState = {
      ...attemptedMarketState,
      routeState: "armed",
      executionState: pendingOrder.kind === "entry" ? "real-pending-entry" : "real-pending-exit",
      isHalted: false,
      pendingIntentKey: intentKey,
      submittedAt: Date.now(),
      orderId: null,
      lastError: null,
    };

    await this.setMarketState(marketKey, pendingMarketState);
    const attemptResult = await this.postAndConfirmOrder(market, marketKey, pendingOrder);
    const confirmation = attemptResult.confirmation;
    const executedPrice = confirmation?.price ?? pendingOrder.limitPrice;
    const executedSize = confirmation?.size ?? pendingOrder.requestedShares;
    const hasTraceableOrderId = attemptResult.orderId !== null && attemptResult.orderId.trim().length > 0;

    if (confirmation !== null && confirmation.ok && confirmation.status === "confirmed") {
      if (!hasTraceableOrderId) {
        qmonEngine.clearRealSeatPendingOrder(marketKey, Date.now());
        await this.haltMarket(qmonEngine, marketKey, "confirmed live order missing traceable orderId");
        return;
      }

      qmonEngine.applyRealSeatPendingOrderFill(marketKey, executedPrice, executedSize, Date.now());
      await this.refreshBalanceSnapshot();
      const updatedPopulation = qmonEngine.getPopulation(marketKey);
      const nextLivePosition = this.createLivePositionStateFromPopulation(updatedPopulation);
      const currentMarketStateAfterFill = this.getMarketState(marketKey);
      const confirmedMarketState: LiveMarketState = {
        ...currentMarketStateAfterFill,
        pendingIntentKey: null,
        submittedAt: null,
        orderId: attemptResult.orderId,
        livePosition: nextLivePosition,
        lastError: null,
        executionState: this.resolveExecutionState(currentMarketStateAfterFill.routeState, updatedPopulation, nextLivePosition, null),
      };

      await this.setMarketState(marketKey, confirmedMarketState);

      if (updatedPopulation !== null && this.hasLiveSeatDivergence(updatedPopulation, this.getMarketState(marketKey))) {
        await this.haltMarket(qmonEngine, marketKey, "confirmed live order did not reconcile cleanly with local seat state");
      }

      return;
    }

    const errorMessage = attemptResult.errorMessage ?? confirmation?.error?.message ?? (confirmation !== null ? `live order ${confirmation.status}` : "live order failed");

    if (attemptResult.orderId !== null) {
      await this.enterRecoveryMarket(qmonEngine, marketKey, errorMessage, attemptResult.orderId);
      return;
    }

    qmonEngine.clearRealSeatPendingOrder(marketKey, Date.now());
    const updatedPopulation = qmonEngine.getPopulation(marketKey);
    const failedMarketState = await this.recordFailure(marketKey);

    if (this.isBalanceError(errorMessage)) {
      this.balanceSnapshot = {
        ...this.balanceSnapshot,
        balanceState: "stale",
      };
      await this.refreshBalanceSnapshot();
    }

    if (errorMessage.includes("traceable orderId") || errorMessage.includes("without id")) {
      await this.haltMarket(qmonEngine, marketKey, errorMessage);
      return;
    }

    if (this.shouldHaltForFailureRate(failedMarketState)) {
      await this.haltMarket(qmonEngine, marketKey, `live failure rate exceeded: ${errorMessage}`);
      return;
    }

    const clearedMarketState: LiveMarketState = {
      ...failedMarketState,
      pendingIntentKey: null,
      submittedAt: null,
      orderId: null,
      livePosition: failedMarketState.livePosition,
      executionState: this.resolveExecutionState(failedMarketState.routeState, updatedPopulation, failedMarketState.livePosition, errorMessage),
      lastError: errorMessage,
    };

    await this.setMarketState(marketKey, clearedMarketState);
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

        const afterPostMarketState = this.getMarketState(marketKey);
        const postedMarketState: LiveMarketState = {
          ...afterPostMarketState,
          orderId: postedOrderId,
        };
        await this.setMarketState(marketKey, postedMarketState);
        this.logLiveExecutionEvent("live-order-posted", marketKey, `posted ${op} ${direction} ${size.toFixed(2)} @ ${price.toFixed(4)} id=${postedOrderId}`);
        const confirmation = await this.orderService.waitForOrderConfirmation({
          order: postedOrder,
          timeoutMs: this.confirmationTimeoutMs,
        });

        if (confirmation.ok && confirmation.status === "confirmed") {
          this.logLiveExecutionEvent("live-order-confirmed", marketKey, `confirmed ${op} ${direction} ${size.toFixed(2)} @ ${price.toFixed(4)} id=${postedOrderId}`);
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

  private buildLiveOrderErrorMessage(
    error: unknown,
    marketSlug: string,
    op: "buy" | "sell",
    direction: "up" | "down",
    size: number,
    price: number,
  ): string {
    const errorDetails = this.describeUnknownError(error);
    const message = `Failed to post order for market=${marketSlug} op=${op} direction=${direction} size=${size.toFixed(4)} price=${price.toFixed(4)}. ${errorDetails}`;

    return message;
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
    let liveMarket: PolymarketMarket | null = cachedLiveMarket?.market ?? null;

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
          await this.setMarketStateFromPopulation(null, "live-market-not-found", marketKey);
          this.logLiveWarning(marketKey, "live-market-resolution-failed", `no active Polymarket market found for ${marketKey}`);
          liveMarket = null;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        await this.setMarketStateFromPopulation(null, message, marketKey);
        this.logLiveWarning(marketKey, "live-market-resolution-failed", message);
        liveMarket = null;
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
    let isBalanceError = false;
    const normalizedMessage = message.toLowerCase();

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
      });
    }

    if (REAL_ACTIVITY_WARNING_CODES.has(warningCode)) {
      logger.warn(this.buildRealActivityLogLine(warningCode, market === "system" ? null : market, details));
    }
  }

  private buildRealActivityLogLine(activityCode: string, market: MarketKey | null, details: string): string {
    const marketLabel = market ?? "system";
    const logLine = `[real-activity] code=${activityCode} market=${marketLabel} ${details}`;

    return logLine;
  }
}
