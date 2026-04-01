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
import type { MarketKey, Qmon, QmonFamilyState, QmonId, QmonPopulation } from "./qmon.types.ts";

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

  public resetCpnlState(state: QmonFamilyState, realExecutionMarkets: readonly MarketKey[] = []): QmonFamilyState {
    const now = Date.now();
    const resetState: QmonFamilyState = {
      ...state,
      populations: state.populations.map((population) => ({
        ...population,
        marketConsolidatedPnl: 0,
        seatPosition: realExecutionMarkets.includes(population.market) ? population.seatPosition : this.createEmptySeatPosition(),
        seatPendingOrder: realExecutionMarkets.includes(population.market) ? population.seatPendingOrder : null,
        seatLastCloseTimestamp: realExecutionMarkets.includes(population.market) ? population.seatLastCloseTimestamp : null,
        seatLastWindowStartMs: realExecutionMarkets.includes(population.market) ? population.seatLastWindowStartMs : null,
        seatLastSettledWindowStartMs: realExecutionMarkets.includes(population.market) ? population.seatLastSettledWindowStartMs : null,
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
      familyState = JSON.parse(json) as QmonFamilyState;
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
