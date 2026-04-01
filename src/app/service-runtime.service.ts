import type { ServerType } from "@hono/node-server";

/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";
import { SnapshotService } from "@sha3/polymarket-snapshot";
import type { SignatureType } from "@polymarket/order-utils";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { HttpServerService } from "../http/http-server.service.ts";
import logger from "../logger.ts";
import {
  QmonEngine,
  QmonLiveStatePersistenceService,
  QmonPersistenceService,
  QmonValidationLogService,
} from "../qmon/index.ts";
import type { PersistedLiveExecutionState } from "../qmon/index.ts";
import { QmonLiveExecutionService } from "../qmon/qmon-live-execution.service.ts";
import { SignalEngine } from "../signal/signal-engine.service.ts";
import type { RuntimeExecutionStatus } from "./app-runtime.types.ts";

/**
 * @section consts
 */

/** Maximum number of snapshots to retain in the rolling buffer. */
const MAX_BUFFER_SIZE = 700;

/**
 * @section class
 */

export class ServiceRuntime {
  /**
   * @section private:attributes
   */

  private readonly httpServerService: HttpServerService;
  private readonly snapshotService: SnapshotService;
  private readonly qmonEngine: QmonEngine;
  private readonly qmonPersistence: QmonPersistenceService;
  private readonly signalEngine: SignalEngine;
  private readonly qmonLiveExecutionService: QmonLiveExecutionService | null;
  private readonly buffer: Snapshot[];
  private lastPersistAt: number;

  /**
   * @section constructor
   */

  public constructor(
    httpServerService: HttpServerService,
    snapshotService: SnapshotService,
    qmonEngine: QmonEngine,
    qmonPersistence: QmonPersistenceService,
    signalEngine: SignalEngine,
    qmonLiveExecutionService: QmonLiveExecutionService | null = null,
  ) {
    this.httpServerService = httpServerService;
    this.snapshotService = snapshotService;
    this.qmonEngine = qmonEngine;
    this.qmonPersistence = qmonPersistence;
    this.signalEngine = signalEngine;
    this.qmonLiveExecutionService = qmonLiveExecutionService;
    this.buffer = [];
    this.lastPersistAt = 0;
  }

  /**
   * @section factory
   */

  public static async createDefault(): Promise<ServiceRuntime> {
    const snapshotService = new SnapshotService(config.SNAPSHOT_INTERVAL_MS);
    const signalEngine = SignalEngine.createDefault();
    const qmonPersistence = QmonPersistenceService.createDefault("./data");
    const qmonLiveStatePersistenceService = QmonLiveStatePersistenceService.createDefault("./data");
    const qmonValidationLogService = QmonValidationLogService.createDefault("./data/qmon-diagnostics");
    await qmonLiveStatePersistenceService.clear();
    await qmonValidationLogService.clearPersistedState();

    // Try to load existing QMON state
    const existingState = await qmonPersistence.load();
    const initialFamilyState = existingState !== null ? qmonPersistence.resetCpnlState(existingState) : null;
    const qmonEngine = existingState
      ? new QmonEngine(config.SIGNAL_ASSETS, config.SIGNAL_WINDOWS, initialFamilyState ?? undefined, signalEngine, undefined, qmonValidationLogService)
      : QmonEngine.createDefault(config.SIGNAL_ASSETS, config.SIGNAL_WINDOWS, signalEngine, qmonValidationLogService);

    // Initialize populations if needed
    if (!existingState) {
      qmonEngine.initializePopulations();
      await qmonPersistence.save(qmonEngine.getFamilyState());
      logger.info("QMON populations initialized");
    } else {
      await qmonPersistence.save(qmonEngine.getFamilyState());
      logger.info("QMON state loaded from persistence with CPnL reset");
    }

    let qmonLiveExecutionService: QmonLiveExecutionService | null = null;

    if (config.QMON_EXECUTION_MODE === "real") {
      qmonLiveExecutionService = new QmonLiveExecutionService(undefined, undefined, qmonLiveStatePersistenceService, qmonValidationLogService);
      const liveExecutionOptions: {
        readonly mode: "real";
        readonly allowlistedMarkets: readonly `${string}-${string}`[];
        readonly privateKey?: string;
        readonly funderAddress?: string;
        readonly signatureType?: SignatureType;
        readonly maxAllowedSlippage?: number;
        readonly confirmationTimeoutMs: number;
        readonly persistedState: PersistedLiveExecutionState | null;
        readonly cpnlSessionStartedAt: number | null;
      } = {
        mode: config.QMON_EXECUTION_MODE,
        allowlistedMarkets: config.QMON_REAL_MARKET_ALLOWLIST,
        confirmationTimeoutMs: config.QMON_REAL_CONFIRMATION_TIMEOUT_MS,
        persistedState: null,
        cpnlSessionStartedAt: qmonValidationLogService.getCpnlSessionStartedAt(),
      };

      if (config.POLYMARKET_PRIVATE_KEY !== undefined) {
        Object.assign(liveExecutionOptions, {
          privateKey: config.POLYMARKET_PRIVATE_KEY,
        });
      }

      if (config.POLYMARKET_FUNDER_ADDRESS !== undefined) {
        Object.assign(liveExecutionOptions, {
          funderAddress: config.POLYMARKET_FUNDER_ADDRESS,
        });
      }

      if (config.POLYMARKET_SIGNATURE_TYPE !== undefined) {
        Object.assign(liveExecutionOptions, {
          signatureType: config.POLYMARKET_SIGNATURE_TYPE as SignatureType,
        });
      }

      if (config.POLYMARKET_MAX_ALLOWED_SLIPPAGE !== undefined) {
        Object.assign(liveExecutionOptions, {
          maxAllowedSlippage: config.POLYMARKET_MAX_ALLOWED_SLIPPAGE,
        });
      }

      await qmonLiveExecutionService.initialize(liveExecutionOptions);
      logger.info("QMON real execution armed");
    } else {
      logger.info("QMON paper execution active");
    }

    // Create HTTP server service with QMON engine
    const serviceRuntimeStatusProvider = (): RuntimeExecutionStatus => {
      const familyState = qmonEngine.getFamilyState();
      const allMarkets = familyState.populations.map((population) => population.market);
      const paperRuntimeExecutionStatus: RuntimeExecutionStatus = {
        mode: "paper",
        allowlistedMarkets: [],
        balanceUsd: null,
        balanceState: "unavailable",
        balanceUpdatedAt: null,
        cpnlSessionStartedAt: qmonValidationLogService.getCpnlSessionStartedAt(),
        marketRoutes: allMarkets.map((market) => ({
          market,
          route: "paper",
          executionState: "paper",
          isHalted: false,
          hasPendingIntent: false,
          pendingIntentKey: null,
          hasLivePosition: false,
          livePositionAction: null,
          confirmedLiveSeat: null,
          lastError: null,
        })),
      };
      const runtimeExecutionStatus =
        qmonLiveExecutionService !== null
          ? qmonLiveExecutionService.getStatus(familyState.populations)
          : paperRuntimeExecutionStatus;

      return runtimeExecutionStatus;
    };
    const httpServerService = HttpServerService.createDefault(qmonEngine, signalEngine, qmonValidationLogService, serviceRuntimeStatusProvider);

    return new ServiceRuntime(httpServerService, snapshotService, qmonEngine, qmonPersistence, signalEngine, qmonLiveExecutionService);
  }

  /**
   * @section private:methods
   */

  /** Handle an incoming snapshot from the live feed. */
  private handleSnapshot(snapshot: Snapshot): void {
    this.buffer.push(snapshot);

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    this.httpServerService.updateSignals(this.buffer);

    // Update QMON with new triggers and signals
    const lastTriggers = this.httpServerService.getLastTriggers();
    const lastRegimes = this.httpServerService.getLastRegimes();
    this.qmonEngine.updateTriggers(lastTriggers);
    this.qmonEngine.updateSnapshots(this.buffer);

    // Evaluate QMONs
    const lastStructuredSignals = this.httpServerService.getLastStructuredSignals();
    const shouldPersist = this.buffer.length % 10 === 0;

    if (lastStructuredSignals) {
      this.qmonEngine.evaluateAll(lastStructuredSignals, lastRegimes, this.buffer, {
        realExecutionMarkets: config.QMON_REAL_MARKET_ALLOWLIST,
      });
      this.qmonLiveExecutionService?.queueSync(this.qmonEngine, lastStructuredSignals);
    }

    void this.persistFamilyState(shouldPersist);
  }

  /** Persist family state when a snapshot changed QMON runtime state or on periodic checkpoints. */
  private async persistFamilyState(shouldPersist: boolean): Promise<void> {
    const mutationState = this.qmonEngine.consumeMutationState();
    const now = Date.now();
    const hasCheckpointElapsed = this.lastPersistAt === 0 || now - this.lastPersistAt >= config.QMON_PERSIST_CHECKPOINT_MS;
    const shouldSaveNow = mutationState.hasCriticalMutation || (shouldPersist && mutationState.hasStateMutation && hasCheckpointElapsed);

    if (shouldSaveNow) {
      const wasSaved = await this.qmonPersistence.save(this.qmonEngine.getFamilyState());

      if (wasSaved) {
        this.lastPersistAt = now;
      } else {
        logger.error("failed to persist QMON state");
      }
    }
  }

  /**
   * @section public:methods
   */

  public buildServer(): ServerType {
    return this.httpServerService.buildServer();
  }

  public startServer(): ServerType {
    const server = this.buildServer();
    server.listen(config.DEFAULT_PORT, () => {
      logger.info(`service listening on http://localhost:${config.DEFAULT_PORT}`);
    });

    this.snapshotService.addSnapshotListener({
      listener: (snapshot) => this.handleSnapshot(snapshot),
    });
    logger.info("snapshot listener registered");

    return server;
  }
}
