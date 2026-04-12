/**
 * @section imports:internals
 */

import type { Qmon, QmonPopulation, QmonRole } from "./qmon.types.ts";

/**
 * @section class
 */

export class QmonChampionService {
  /**
   * @section factory
   */

  public static createDefault(): QmonChampionService {
    const championService = new QmonChampionService();

    return championService;
  }

  /**
   * @section private:methods
   */

  private calculateRecentWindowPnlSum(qmon: Qmon): number {
    const recentWindowPnlSum = qmon.metrics.recentWindowPnls.reduce((runningWindowPnl, windowPnl) => runningWindowPnl + windowPnl, 0);

    return recentWindowPnlSum;
  }

  private refreshQmonActivity(qmon: Qmon): Qmon {
    const recentWindowPnlSum = this.calculateRecentWindowPnlSum(qmon);
    const isActive = recentWindowPnlSum > 0;
    const refreshedQmon: Qmon = {
      ...qmon,
      metrics: {
        ...qmon.metrics,
        recentWindowPnlSum,
        isActive,
      },
    };

    return refreshedQmon;
  }

  /**
   * @section public:methods
   */

  public refreshPopulation(population: QmonPopulation): QmonPopulation {
    const refreshedQmons = population.qmons.map((qmon) => this.refreshQmonActivity(qmon));
    let selectedChampion: Qmon | null = null;

    for (const qmon of refreshedQmons) {
      const canReplaceChampion =
        qmon.metrics.isActive && (selectedChampion === null || qmon.metrics.recentWindowPnlSum > selectedChampion.metrics.recentWindowPnlSum);

      if (canReplaceChampion) {
        selectedChampion = qmon;
      }
    }

    const activeChampionQmonId = selectedChampion?.id ?? null;
    const qmonsWithRoles = refreshedQmons.map((qmon) => ({
      ...qmon,
      role: (activeChampionQmonId !== null && qmon.id === activeChampionQmonId ? "champion" : "candidate") as QmonRole,
    }));
    const refreshedPopulation: QmonPopulation = {
      ...population,
      activeChampionQmonId,
      qmons: qmonsWithRoles,
    };

    return refreshedPopulation;
  }
}
