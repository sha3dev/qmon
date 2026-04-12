/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { AssetResult, AssetSignals, HorizonSignalValues, StructuredSignalResult, WindowPriceData, WindowResult, WindowSignals } from "./signal.types.ts";

/**
 * @section class
 */

export class SignalEngine {
  /**
   * @section private:attributes
   */

  private readonly assets: readonly string[];
  private readonly windows: readonly string[];
  private readonly snapshotIntervalMs: number;
  private readonly horizonLabels: readonly string[];

  /**
   * @section constructor
   */

  public constructor(assets: readonly string[], windows: readonly string[], snapshotIntervalMs: number, horizonsSec: readonly number[]) {
    this.assets = assets;
    this.windows = windows;
    this.snapshotIntervalMs = snapshotIntervalMs;
    this.horizonLabels = horizonsSec.map((horizonSec) => `${Math.round(horizonSec / 60) || 1}m`);
  }

  /**
   * @section factory
   */

  public static createDefault(): SignalEngine {
    const signalEngine = new SignalEngine(config.SIGNAL_ASSETS, config.SIGNAL_WINDOWS, config.SNAPSHOT_INTERVAL_MS, config.SIGNAL_HORIZONS_SEC);

    return signalEngine;
  }

  /**
   * @section private:methods
   */

  private extractNumber(snapshot: Snapshot | undefined, fieldName: string): number | null {
    const rawValue = snapshot ? (snapshot[fieldName] ?? null) : null;
    const numericValue = typeof rawValue === "number" ? rawValue : null;

    return numericValue;
  }

  private extractTimestampMs(snapshot: Snapshot | undefined, fieldName: string): number | null {
    const rawValue = snapshot ? (snapshot[fieldName] ?? null) : null;
    let timestampMs: number | null = null;

    if (typeof rawValue === "number") {
      timestampMs = rawValue;
    } else {
      if (typeof rawValue === "string") {
        const parsedTimestamp = new Date(rawValue).getTime();

        if (Number.isFinite(parsedTimestamp)) {
          timestampMs = parsedTimestamp;
        }
      }
    }

    return timestampMs;
  }

  private buildEmptyHorizons(): HorizonSignalValues {
    const horizonValues = this.horizonLabels.reduce<Record<string, number | null>>(
      (runningHorizons, horizonLabel) => {
        runningHorizons[horizonLabel] = null;

        return runningHorizons;
      },
      { "30s": null, "2m": null, "5m": null },
    );

    return horizonValues;
  }

  private calculateSimpleMomentum(snapshots: readonly Snapshot[], asset: string): number | null {
    let normalizedMomentum: number | null = null;

    if (snapshots.length >= 2) {
      const latestSnapshot = snapshots[snapshots.length - 1];
      const previousSnapshot = snapshots[snapshots.length - 2];
      const latestChainlinkPrice = this.extractNumber(latestSnapshot, `${asset}_chainlink_price`);
      const previousChainlinkPrice = this.extractNumber(previousSnapshot, `${asset}_chainlink_price`);

      if (latestChainlinkPrice !== null && previousChainlinkPrice !== null && previousChainlinkPrice !== 0) {
        const rawMomentum = (latestChainlinkPrice - previousChainlinkPrice) / previousChainlinkPrice;

        normalizedMomentum = Math.max(-1, Math.min(1, rawMomentum * 100));
      }
    }

    return normalizedMomentum;
  }

  private buildAssetSignals(snapshots: readonly Snapshot[], asset: string): AssetSignals {
    const normalizedMomentum = this.calculateSimpleMomentum(snapshots, asset);
    const assetSignals: AssetSignals = {
      velocity: { ...this.buildEmptyHorizons(), "30s": normalizedMomentum },
      momentum: { ...this.buildEmptyHorizons(), "30s": normalizedMomentum, "2m": normalizedMomentum, "5m": normalizedMomentum },
      meanReversion: this.buildEmptyHorizons(),
      oracleLag: normalizedMomentum,
      dispersion: 0,
      imbalance: 0,
      microprice: 0,
      staleness: 0,
      acceleration: 0,
      volatilityRegime: 0,
      spread: 0,
      bookDepth: 0,
      crossAssetMomentum: normalizedMomentum,
    };

    return assetSignals;
  }

  private buildWindowSignals(): WindowSignals {
    const windowSignals: WindowSignals = {
      distance: 0,
      zScore: 0,
      edge: 0,
      tokenPressure: 0,
      marketEfficiency: 0,
    };

    return windowSignals;
  }

  private buildWindowPriceData(snapshot: Snapshot | undefined, asset: string, windowLabel: string): WindowPriceData {
    const prefix = `${asset}_${windowLabel}`;
    const windowPriceData: WindowPriceData = {
      priceToBeat: this.extractNumber(snapshot, `${prefix}_price_to_beat`),
      upPrice: this.extractNumber(snapshot, `${prefix}_up_price`),
      downPrice: this.extractNumber(snapshot, `${prefix}_down_price`),
      marketStartMs: this.extractTimestampMs(snapshot, `${prefix}_market_start`),
      marketEndMs: this.extractTimestampMs(snapshot, `${prefix}_market_end`),
    };

    return windowPriceData;
  }

  /**
   * @section public:methods
   */

  public calculateStructured(snapshots: readonly Snapshot[]): StructuredSignalResult {
    const latestSnapshot = snapshots[snapshots.length - 1];
    const structuredSignals: StructuredSignalResult = {};

    for (const asset of this.assets) {
      const assetSignals = this.buildAssetSignals(snapshots, asset);
      const windowResults: Record<string, WindowResult> = {};

      for (const windowLabel of this.windows) {
        windowResults[windowLabel] = {
          signals: this.buildWindowSignals(),
          prices: this.buildWindowPriceData(latestSnapshot, asset, windowLabel),
        };
      }

      const assetResult: AssetResult = {
        chainlinkPrice: this.extractNumber(latestSnapshot, `${asset}_chainlink_price`),
        signals: assetSignals,
        windows: windowResults,
      };

      structuredSignals[asset] = assetResult;
    }

    void this.snapshotIntervalMs;

    return structuredSignals;
  }
}
