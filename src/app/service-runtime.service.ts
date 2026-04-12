import type { ServerType } from "@hono/node-server";

/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";
import { SnapshotService } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { HttpServerService } from "../http/http-server.service.ts";
import logger from "../logger.ts";
import { QmonEngine, QmonLiveExecutionService, QmonPersistenceService } from "../qmon/index.ts";
import type { ExecutionMode, RuntimeExecutionStatus, RuntimeMarketRoute } from "./app-runtime.types.ts";

/**
 * @section consts
 */

const MAX_BUFFER_SIZE = 700;

/**
 * @section types
 */

type ServiceRuntimeCreateDefaultOptions = {
  readonly dataDir?: string;
};

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
  private readonly qmonLiveExecutionService: QmonLiveExecutionService;
  private readonly executionMode: ExecutionMode;
  private readonly buffer: Snapshot[];
  private lastPersistAt: number;
  private snapshotQueue: Promise<void>;

  /**
   * @section constructor
   */

  public constructor(
    httpServerService: HttpServerService,
    snapshotService: SnapshotService,
    qmonEngine: QmonEngine,
    qmonPersistence: QmonPersistenceService,
    qmonLiveExecutionService: QmonLiveExecutionService,
    executionMode: ExecutionMode,
  ) {
    this.httpServerService = httpServerService;
    this.snapshotService = snapshotService;
    this.qmonEngine = qmonEngine;
    this.qmonPersistence = qmonPersistence;
    this.qmonLiveExecutionService = qmonLiveExecutionService;
    this.executionMode = executionMode;
    this.buffer = [];
    this.lastPersistAt = 0;
    this.snapshotQueue = Promise.resolve();
  }

  /**
   * @section factory
   */

  public static async createDefault(options: ServiceRuntimeCreateDefaultOptions = {}): Promise<ServiceRuntime> {
    const dataDir = options.dataDir ?? "./data";
    const snapshotService = new SnapshotService(config.SNAPSHOT_INTERVAL_MS);
    const qmonPersistence = QmonPersistenceService.createDefault(dataDir);
    const persistedFamilyState = await qmonPersistence.load();
    const qmonEngine = QmonEngine.createDefault(config.SIGNAL_ASSETS, config.SIGNAL_WINDOWS, persistedFamilyState ?? undefined);
    const qmonLiveExecutionService = QmonLiveExecutionService.createDefault(config.QMON_MIN_ENTRY_SHARES);
    const httpServerService = HttpServerService.createDefault(qmonEngine, undefined, config.QMON_EXECUTION_MODE);

    if (persistedFamilyState === null) {
      await qmonPersistence.save(qmonEngine.getFamilyState());
    }

    return new ServiceRuntime(httpServerService, snapshotService, qmonEngine, qmonPersistence, qmonLiveExecutionService, config.QMON_EXECUTION_MODE);
  }

  /**
   * @section private:methods
   */

  private buildRuntimeExecutionStatus(): RuntimeExecutionStatus {
    const marketRoutes: RuntimeMarketRoute[] = this.qmonEngine.getFamilyState().populations.map((population) => ({
      market: population.market,
      route: population.realSeat.route,
      hasChampion: population.activeChampionQmonId !== null,
      hasRealSeat: population.realSeat.hasOpenPosition,
      realSeat: population.realSeat,
    }));
    const runtimeExecutionStatus: RuntimeExecutionStatus = {
      mode: this.executionMode,
      marketRoutes,
    };

    return runtimeExecutionStatus;
  }

  private handleSnapshot(snapshot: Snapshot): void {
    const previousSnapshotQueue = this.snapshotQueue;

    this.snapshotQueue = this.processSnapshot(snapshot, previousSnapshotQueue);
  }

  private async processSnapshot(snapshot: Snapshot, previousSnapshotQueue: Promise<void>): Promise<void> {
    try {
      await previousSnapshotQueue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error(`previous snapshot processing failed: ${message}`);
    }

    this.buffer.push(snapshot);

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    this.httpServerService.updateSignals(this.buffer);

    const structuredSignals = this.httpServerService.getLastStructuredSignals();
    const regimes = this.httpServerService.getLastRegimes();

    if (structuredSignals !== null) {
      this.qmonEngine.evaluateAll(structuredSignals, regimes, snapshot.generated_at);
      this.qmonEngine.replaceFamilyState(
        this.qmonLiveExecutionService.syncFamilyState(this.qmonEngine.getFamilyState(), this.executionMode, snapshot.generated_at),
      );
      this.httpServerService.setRuntimeExecutionStatus(this.buildRuntimeExecutionStatus());
    }

    await this.persistFamilyState();
  }

  private async persistFamilyState(): Promise<void> {
    const mutationState = this.qmonEngine.consumeMutationState();
    const now = Date.now();
    const hasCheckpointElapsed = this.lastPersistAt === 0 || now - this.lastPersistAt >= config.QMON_PERSIST_CHECKPOINT_MS;
    const shouldSaveNow = mutationState.hasCriticalMutation || (mutationState.hasStateMutation && hasCheckpointElapsed);

    if (shouldSaveNow) {
      const hasSavedFamilyState = await this.qmonPersistence.save(this.qmonEngine.getFamilyState());

      if (hasSavedFamilyState) {
        this.lastPersistAt = now;
      }
    }
  }

  /**
   * @section public:methods
   */

  public buildServer(): ServerType {
    const runtimeExecutionStatus = this.buildRuntimeExecutionStatus();

    this.httpServerService.setRuntimeExecutionStatus(runtimeExecutionStatus);

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
