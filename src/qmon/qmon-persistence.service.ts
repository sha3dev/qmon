/**
 * @section imports:externals
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { generateQmonId } from "./qmon-genome.service.ts";
import type {
  MarketKey,
  Qmon,
  QmonExecutionRoute,
  QmonExecutionRuntime,
  QmonFamilyState,
  QmonId,
  QmonPopulation,
} from "./qmon.types.ts";
import type { PersistedLiveExecutionState, PersistedLiveSeatState, PersistedMarketLiveState } from "./qmon-live-state-persistence.service.ts";

/**
 * @section consts
 */

const FAMILY_STATE_FILENAME = "family-state.json";

/**
 * @section class
 */

export class QmonPersistenceService {
  /**
   * @section private:attributes
   */

  private readonly dataDir: string;
  private writeQueue: Promise<boolean>;

  /**
   * @section constructor
   */

  public constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.writeQueue = Promise.resolve(true);
  }

  /**
   * @section factory
   */

  public static createDefault(dataDir = "./data"): QmonPersistenceService {
    return new QmonPersistenceService(dataDir);
  }

  /**
   * @section private:methods
   */

  private getFamilyStatePath(): string {
    return join(this.dataDir, FAMILY_STATE_FILENAME);
  }

  private getTempFilePath(targetPath: string): string {
    return `${targetPath}.tmp`;
  }

  private async persistState(state: QmonFamilyState): Promise<boolean> {
    let isSaved = true;

    try {
      await mkdir(this.dataDir, { recursive: true });
      const targetPath = this.getFamilyStatePath();
      const tempPath = this.getTempFilePath(targetPath);
      const json = JSON.stringify(state, null, 2);
      await writeFile(tempPath, json, "utf-8");
      await rename(tempPath, targetPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save family state: ${message}`);
      isSaved = false;
    }

    return isSaved;
  }

  private getConfiguredMarkets(): readonly MarketKey[] {
    const marketKeys: MarketKey[] = [];

    for (const asset of config.SIGNAL_ASSETS) {
      for (const window of config.SIGNAL_WINDOWS) {
        marketKeys.push(`${asset}-${window}` as MarketKey);
      }
    }

    return marketKeys;
  }

  private createEmptySeatPosition(): QmonPopulation["seatPosition"] {
    const emptySeatPosition: QmonPopulation["seatPosition"] = {
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

    return emptySeatPosition;
  }

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

  private createConfirmedVenueSeatFromLegacy(
    persistedLiveSeatState: PersistedLiveSeatState | null,
  ): QmonExecutionRuntime["confirmedVenueSeat"] {
    let confirmedVenueSeat: QmonExecutionRuntime["confirmedVenueSeat"] = null;

    if (persistedLiveSeatState !== null) {
      confirmedVenueSeat = {
        action: persistedLiveSeatState.action,
        shareCount: persistedLiveSeatState.shareCount,
        entryPrice: persistedLiveSeatState.entryPrice,
        enteredAt: persistedLiveSeatState.enteredAt,
      };
    }

    return confirmedVenueSeat;
  }

  private createExecutionRuntimeFromLegacyMarketState(
    persistedMarketLiveState: PersistedMarketLiveState | null,
  ): QmonExecutionRuntime | null {
    let executionRuntime: QmonExecutionRuntime | null = null;

    if (persistedMarketLiveState !== null) {
      const isHalted = persistedMarketLiveState.routeState !== "armed";
      const recoveryStartedAt = persistedMarketLiveState.routeState === "recovery-required" ? persistedMarketLiveState.submittedAt : null;

      executionRuntime = {
        route: "real",
        executionState: "real-armed",
        pendingIntent: null,
        orderId: persistedMarketLiveState.orderId,
        submittedAt: persistedMarketLiveState.submittedAt,
        confirmedVenueSeat: this.createConfirmedVenueSeatFromLegacy(persistedMarketLiveState.confirmedLiveSeat),
        pendingVenueOrders: [],
        recoveryStartedAt,
        lastReconciledAt: null,
        lastError: persistedMarketLiveState.lastError,
        isHalted,
      };
      executionRuntime = {
        ...executionRuntime,
        executionState: this.resolveExecutionState(executionRuntime),
      };
    }

    return executionRuntime;
  }

  private findLegacyMarketState(
    legacyLiveExecutionState: PersistedLiveExecutionState | null,
    market: MarketKey,
  ): PersistedMarketLiveState | null {
    const persistedMarketLiveState = legacyLiveExecutionState?.markets.find((persistedMarket) => persistedMarket.market === market) ?? null;

    return persistedMarketLiveState;
  }

  private normalizeExecutionRuntime(
    population: QmonPopulation,
    route: QmonExecutionRoute,
    legacyLiveExecutionState: PersistedLiveExecutionState | null,
  ): QmonExecutionRuntime {
    const legacyExecutionRuntime = this.createExecutionRuntimeFromLegacyMarketState(this.findLegacyMarketState(legacyLiveExecutionState, population.market));
    const currentExecutionRuntime = population.executionRuntime ?? legacyExecutionRuntime ?? this.createDefaultExecutionRuntime(route);
    const normalizedExecutionRuntime: QmonExecutionRuntime = {
      route,
      executionState: currentExecutionRuntime.executionState,
      pendingIntent: route === "real" ? population.seatPendingOrder ?? currentExecutionRuntime.pendingIntent : null,
      orderId: route === "real" ? currentExecutionRuntime.orderId : null,
      submittedAt: route === "real" ? currentExecutionRuntime.submittedAt : null,
      confirmedVenueSeat: route === "real" ? currentExecutionRuntime.confirmedVenueSeat : null,
      pendingVenueOrders: route === "real" ? currentExecutionRuntime.pendingVenueOrders : [],
      recoveryStartedAt: route === "real" ? currentExecutionRuntime.recoveryStartedAt : null,
      lastReconciledAt: route === "real" ? currentExecutionRuntime.lastReconciledAt : null,
      lastError: route === "real" ? currentExecutionRuntime.lastError : null,
      isHalted: route === "real" ? currentExecutionRuntime.isHalted : false,
    };
    const resolvedExecutionRuntime: QmonExecutionRuntime = {
      ...normalizedExecutionRuntime,
      executionState: this.resolveExecutionState(normalizedExecutionRuntime),
    };

    return resolvedExecutionRuntime;
  }

  private normalizePopulation(
    population: QmonPopulation,
    route: QmonExecutionRoute,
    legacyLiveExecutionState: PersistedLiveExecutionState | null,
  ): QmonPopulation {
    const normalizedPopulation: QmonPopulation = {
      ...population,
      executionRuntime: this.normalizeExecutionRuntime(population, route, legacyLiveExecutionState),
    };

    return normalizedPopulation;
  }

  /**
   * @section public:methods
   */

  public async saveQmon(qmon: Qmon): Promise<boolean> {
    const existingState = await this.load();
    const nextState = existingState ?? {
      populations: [],
      globalGeneration: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    const populationIndex = nextState.populations.findIndex((population) => population.market === qmon.market);
    const nextPopulations = [...nextState.populations];

    if (populationIndex >= 0) {
      const currentPopulation = nextPopulations[populationIndex];

      if (currentPopulation !== undefined) {
        const nextQmons = currentPopulation.qmons.filter((currentQmon) => currentQmon.id !== qmon.id);
        nextPopulations[populationIndex] = {
          ...currentPopulation,
          qmons: [...nextQmons, qmon],
          lastUpdated: Date.now(),
        };
      }
    } else {
      nextPopulations.push({
        market: qmon.market,
        qmons: [qmon],
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        activeChampionQmonId: null,
        marketConsolidatedPnl: 0,
        seatPosition: {
          action: null,
          enteredAt: null,
          entryScore: null,
          entryPrice: null,
          peakReturnPct: null,
          shareCount: null,
          priceToBeat: null,
          marketStartMs: null,
          marketEndMs: null,
        },
        seatPendingOrder: null,
        seatLastCloseTimestamp: null,
        seatLastWindowStartMs: null,
        seatLastSettledWindowStartMs: null,
        executionRuntime: this.createDefaultExecutionRuntime("paper"),
      });
    }

    return this.save({
      ...nextState,
      populations: nextPopulations,
      lastUpdated: Date.now(),
    });
  }

  public async savePopulation(population: QmonPopulation): Promise<boolean> {
    const existingState = await this.load();
    const nextState = existingState ?? {
      populations: [],
      globalGeneration: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    const populationIndex = nextState.populations.findIndex((existingPopulation) => existingPopulation.market === population.market);
    const nextPopulations = [...nextState.populations];

    if (populationIndex >= 0) {
      nextPopulations[populationIndex] = population;
    } else {
      nextPopulations.push(population);
    }

    return this.save({
      ...nextState,
      populations: nextPopulations,
      lastUpdated: Date.now(),
    });
  }

  public async save(state: QmonFamilyState): Promise<boolean> {
    const nextWrite = this.writeQueue.then(async () => this.persistState(state));
    this.writeQueue = nextWrite.catch(async () => false);
    const isSaved = await nextWrite;

    return isSaved;
  }

  public normalizeFamilyState(
    state: QmonFamilyState,
    executionMode: QmonExecutionRoute = "paper",
    legacyLiveExecutionState: PersistedLiveExecutionState | null = null,
  ): QmonFamilyState {
    const normalizedState: QmonFamilyState = {
      ...state,
      populations: state.populations.map((population) =>
        this.normalizePopulation(
          population,
          executionMode === "real" ? "real" : population.executionRuntime?.route ?? "paper",
          legacyLiveExecutionState,
        ),
      ),
    };

    return normalizedState;
  }

  public resetCpnlState(state: QmonFamilyState, executionMode: QmonExecutionRoute = "paper"): QmonFamilyState {
    const now = Date.now();
    const resetState: QmonFamilyState = {
      ...state,
      populations: state.populations.map((population) => ({
        ...population,
        marketConsolidatedPnl: 0,
        seatPosition: executionMode === "real" ? population.seatPosition : this.createEmptySeatPosition(),
        seatPendingOrder: executionMode === "real" ? population.seatPendingOrder : null,
        seatLastCloseTimestamp: executionMode === "real" ? population.seatLastCloseTimestamp : null,
        seatLastWindowStartMs: executionMode === "real" ? population.seatLastWindowStartMs : null,
        seatLastSettledWindowStartMs: executionMode === "real" ? population.seatLastSettledWindowStartMs : null,
        executionRuntime: this.normalizeExecutionRuntime(
          {
            ...population,
            seatPosition: executionMode === "real" ? population.seatPosition : this.createEmptySeatPosition(),
            seatPendingOrder: executionMode === "real" ? population.seatPendingOrder : null,
          },
          executionMode,
          null,
        ),
        lastUpdated: now,
      })),
      lastUpdated: now,
    };

    return resetState;
  }

  public async load(): Promise<QmonFamilyState | null> {
    const familyStatePath = this.getFamilyStatePath();
    let familyState: QmonFamilyState | null = null;

    if (!existsSync(familyStatePath)) {
      return familyState;
    }

    try {
      const json = await readFile(familyStatePath, "utf-8");
      familyState = this.normalizeFamilyState(JSON.parse(json) as QmonFamilyState);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load family state: ${message}`);
    }

    return familyState;
  }

  public async loadPopulation(market: string): Promise<QmonPopulation | null> {
    const familyState = await this.load();
    const population = familyState?.populations.find((existingPopulation) => existingPopulation.market === market) ?? null;

    return population;
  }

  public async exists(): Promise<boolean> {
    return existsSync(this.getFamilyStatePath());
  }

  public async deleteQmon(market: string, qmonId: QmonId): Promise<boolean> {
    const familyState = await this.load();
    let isDeleted = true;

    if (familyState === null) {
      return isDeleted;
    }

    const nextPopulations = familyState.populations.map((population) => {
      if (population.market !== market) {
        return population;
      }

      return {
        ...population,
        qmons: population.qmons.filter((qmon) => qmon.id !== qmonId),
      };
    });

    isDeleted = await this.save({
      ...familyState,
      populations: nextPopulations,
      lastUpdated: Date.now(),
    });

    return isDeleted;
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  public generateUniqueId(): QmonId {
    return generateQmonId();
  }

  public getAllMarkets(): readonly string[] {
    return this.getConfiguredMarkets();
  }
}
