/**
 * @section imports:externals
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @section imports:internals
 */

import type { TradingAction } from "./qmon.types.ts";

/**
 * @section consts
 */

const LIVE_STATE_FILENAME = "qmon-live-state.json";

/**
 * @section types
 */

export type PersistedLiveSeatState = {
  readonly action: TradingAction;
  readonly shareCount: number;
  readonly entryPrice: number | null;
  readonly enteredAt: number;
};

export type PersistedMarketLiveState = {
  readonly market: `${string}-${string}`;
  readonly routeState: "armed" | "halted" | "recovery-required";
  readonly pendingIntentKey: string | null;
  readonly submittedAt: number | null;
  readonly orderId: string | null;
  readonly confirmedLiveSeat: PersistedLiveSeatState | null;
  readonly lastError: string | null;
};

export type PersistedLiveExecutionState = {
  readonly updatedAt: number;
  readonly markets: readonly PersistedMarketLiveState[];
};

/**
 * @section class
 */

export class QmonLiveStatePersistenceService {
  /**
   * @section private:attributes
   */

  private readonly dataDir: string;

  /**
   * @section constructor
   */

  public constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * @section factory
   */

  public static createDefault(dataDir = "./data"): QmonLiveStatePersistenceService {
    return new QmonLiveStatePersistenceService(dataDir);
  }

  /**
   * @section private:methods
   */

  private getStatePath(): string {
    const statePath = join(this.dataDir, LIVE_STATE_FILENAME);

    return statePath;
  }

  private getTempPath(statePath: string): string {
    const tempPath = `${statePath}.tmp`;

    return tempPath;
  }

  /**
   * @section public:methods
   */

  public async load(): Promise<PersistedLiveExecutionState | null> {
    const statePath = this.getStatePath();
    let persistedState: PersistedLiveExecutionState | null = null;

    if (!existsSync(statePath)) {
      return persistedState;
    }

    try {
      const rawState = await readFile(statePath, "utf-8");
      persistedState = JSON.parse(rawState) as PersistedLiveExecutionState;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load live execution state: ${message}`);
    }

    return persistedState;
  }

  public async save(state: PersistedLiveExecutionState): Promise<boolean> {
    let isSaved = true;

    try {
      await mkdir(this.dataDir, { recursive: true });
      const statePath = this.getStatePath();
      const tempPath = this.getTempPath(statePath);
      await writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
      await rename(tempPath, statePath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to save live execution state: ${message}`);
      isSaved = false;
    }

    return isSaved;
  }

  public async clear(): Promise<boolean> {
    const statePath = this.getStatePath();
    let isCleared = true;

    try {
      await rm(statePath, {
        force: true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to clear live execution state: ${message}`);
      isCleared = false;
    }

    return isCleared;
  }
}
