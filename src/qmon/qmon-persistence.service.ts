/**
 * @section imports:externals
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * @section imports:internals
 */

import logger from "../logger.ts";
import type { QmonFamilyState } from "./qmon.types.ts";

/**
 * @section class
 */

export class QmonPersistenceService {
  /**
   * @section private:attributes
   */

  private readonly familyStatePath: string;

  /**
   * @section constructor
   */

  public constructor(familyStatePath: string) {
    this.familyStatePath = familyStatePath;
  }

  /**
   * @section factory
   */

  public static createDefault(dataDir: string): QmonPersistenceService {
    const familyStatePath = join(dataDir, "qmon-v1-state.json");
    const persistenceService = new QmonPersistenceService(familyStatePath);

    return persistenceService;
  }

  /**
   * @section private:methods
   */

  private isValidFamilyState(parsedValue: unknown): parsedValue is QmonFamilyState {
    const parsedRecord = typeof parsedValue === "object" && parsedValue !== null ? (parsedValue as Record<string, unknown>) : null;
    const hasValidShape =
      parsedRecord !== null &&
      parsedRecord.schemaVersion === 1 &&
      Array.isArray(parsedRecord.populations) &&
      typeof parsedRecord.createdAt === "number" &&
      typeof parsedRecord.lastUpdated === "number";

    return hasValidShape;
  }

  /**
   * @section public:methods
   */

  public async load(): Promise<QmonFamilyState | null> {
    let familyState: QmonFamilyState | null = null;

    try {
      const fileContents = await readFile(this.familyStatePath, "utf-8");
      const parsedValue: unknown = JSON.parse(fileContents);

      if (this.isValidFamilyState(parsedValue)) {
        familyState = parsedValue;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      logger.warn(`QMON v1 state load skipped: ${message}`);
    }

    return familyState;
  }

  public async save(familyState: QmonFamilyState): Promise<boolean> {
    let hasSavedFamilyState = false;

    try {
      await mkdir(dirname(this.familyStatePath), { recursive: true });
      await writeFile(this.familyStatePath, JSON.stringify(familyState, null, 2), "utf-8");
      hasSavedFamilyState = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error(`QMON v1 state save failed: ${message}`);
    }

    return hasSavedFamilyState;
  }
}
