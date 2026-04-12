/**
 * @section imports:internals
 */

import type { QmonFamilyState, QmonPopulation, QmonRealSeat } from "./qmon.types.ts";

/**
 * @section class
 */

export class QmonLiveExecutionService {
  /**
   * @section private:attributes
   */

  private readonly minimumVenueShares: number;

  /**
   * @section constructor
   */

  public constructor(minimumVenueShares: number) {
    this.minimumVenueShares = minimumVenueShares;
  }

  /**
   * @section factory
   */

  public static createDefault(minimumVenueShares: number): QmonLiveExecutionService {
    const liveExecutionService = new QmonLiveExecutionService(minimumVenueShares);

    return liveExecutionService;
  }

  /**
   * @section private:methods
   */

  private buildPaperSeat(population: QmonPopulation, synchronizedAt: number): QmonRealSeat {
    const paperSeat: QmonRealSeat = {
      route: "paper",
      mirroredQmonId: null,
      action: null,
      shareCount: null,
      entryPrice: null,
      hasOpenPosition: false,
      lastSyncedAt: synchronizedAt,
    };

    void population;

    return paperSeat;
  }

  private buildRealSeat(population: QmonPopulation, synchronizedAt: number): QmonRealSeat {
    const championQmon = population.qmons.find((qmon) => qmon.id === population.activeChampionQmonId) ?? null;
    const paperPosition = championQmon?.paperPosition ?? null;
    const synchronizedShareCount =
      paperPosition?.shareCount !== null && paperPosition?.shareCount !== undefined ? Math.max(paperPosition.shareCount, this.minimumVenueShares) : null;
    const realSeat: QmonRealSeat = {
      route: "real",
      mirroredQmonId: championQmon?.id ?? null,
      action: paperPosition?.action ?? null,
      shareCount: synchronizedShareCount,
      entryPrice: paperPosition?.entryPrice ?? null,
      hasOpenPosition: (paperPosition?.action ?? null) !== null,
      lastSyncedAt: synchronizedAt,
    };

    return realSeat;
  }

  /**
   * @section public:methods
   */

  public syncFamilyState(familyState: QmonFamilyState, executionMode: "paper" | "real", synchronizedAt: number): QmonFamilyState {
    const synchronizedPopulations = familyState.populations.map((population) => {
      const synchronizedRealSeat = executionMode === "real" ? this.buildRealSeat(population, synchronizedAt) : this.buildPaperSeat(population, synchronizedAt);
      const synchronizedPopulation: QmonPopulation = {
        ...population,
        realSeat: synchronizedRealSeat,
        lastUpdated: synchronizedAt,
      };

      return synchronizedPopulation;
    });
    const synchronizedFamilyState: QmonFamilyState = {
      ...familyState,
      populations: synchronizedPopulations,
      lastUpdated: synchronizedAt,
    };

    return synchronizedFamilyState;
  }

  public resolveMirroredShareCount(requestedShareCount: number, venueMinimumShares: number): number {
    const mirroredShareCount = Math.max(requestedShareCount, venueMinimumShares);

    return mirroredShareCount;
  }
}
