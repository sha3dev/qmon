/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { SignalAcceleration } from "./signal-acceleration.service.ts";
import { SignalBookDepth } from "./signal-book-depth.service.ts";
import { SignalBookParser } from "./signal-book-parser.service.ts";
import { SignalCrossAssetMomentum } from "./signal-cross-asset-momentum.service.ts";
import { SignalDispersion } from "./signal-dispersion.service.ts";
import { SignalDistance } from "./signal-distance.service.ts";
import { SignalEdge } from "./signal-edge.service.ts";
import type { ExchangeWeights } from "./signal-exchange-weighted-calculator.service.ts";
import { SignalImbalance } from "./signal-imbalance.service.ts";
import { SignalMarketEfficiency } from "./signal-market-efficiency.service.ts";
import { SignalMeanReversion } from "./signal-mean-reversion.service.ts";
import { SignalMicroprice } from "./signal-microprice.service.ts";
import { SignalMomentum } from "./signal-momentum.service.ts";
import { SignalOracleLag } from "./signal-oracle-lag.service.ts";
import { SignalSpread } from "./signal-spread.service.ts";
import { SignalStaleness } from "./signal-staleness.service.ts";
import { SignalTokenPressure } from "./signal-token-pressure.service.ts";
import { SignalVelocity } from "./signal-velocity.service.ts";
import { SignalVolatilityRegime } from "./signal-volatility-regime.service.ts";
import { SignalZScore } from "./signal-z-score.service.ts";
import type { AssetResult, AssetSignals, SignalValue, StructuredSignalResult, WindowPriceData, WindowResult, WindowSignals } from "./signal.types.ts";

/**
 * @section class
 */
export class SignalEngine {
  /**
   * @section private:attributes
   */

  private readonly assets: readonly string[];
  private readonly windows: readonly string[];
  private readonly distance: SignalDistance;
  private readonly zScore: SignalZScore;
  private readonly velocity: SignalVelocity;
  private readonly oracleLag: SignalOracleLag;
  private readonly dispersion: SignalDispersion;
  private readonly imbalance: SignalImbalance;
  private readonly microprice: SignalMicroprice;
  private readonly edge: SignalEdge;
  private readonly tokenPressure: SignalTokenPressure;
  private readonly staleness: SignalStaleness;
  private readonly momentum: SignalMomentum;
  private readonly acceleration: SignalAcceleration;
  private readonly volatilityRegime: SignalVolatilityRegime;
  private readonly meanReversion: SignalMeanReversion;
  private readonly signalSpread: SignalSpread;
  private readonly bookDepth: SignalBookDepth;
  private readonly marketEfficiency: SignalMarketEfficiency;
  private readonly crossAssetMomentum: SignalCrossAssetMomentum;

  /**
   * @section constructor
   */

  public constructor(
    assets: readonly string[],
    windows: readonly string[],
    snapshotIntervalMs: number,
    horizonsSec: readonly number[],
    exchanges: readonly string[],
  ) {
    this.assets = assets;
    this.windows = windows;

    const bookParser = new SignalBookParser();

    this.distance = new SignalDistance();
    this.zScore = new SignalZScore(snapshotIntervalMs);
    this.velocity = new SignalVelocity(snapshotIntervalMs, horizonsSec);
    this.oracleLag = new SignalOracleLag(exchanges);
    this.dispersion = new SignalDispersion(exchanges);
    this.imbalance = new SignalImbalance(exchanges, bookParser);
    this.microprice = new SignalMicroprice(exchanges, bookParser);
    this.edge = new SignalEdge(snapshotIntervalMs, bookParser);
    this.tokenPressure = new SignalTokenPressure(bookParser);
    this.staleness = new SignalStaleness(exchanges);
    this.momentum = new SignalMomentum(snapshotIntervalMs, horizonsSec);
    this.acceleration = new SignalAcceleration();
    this.volatilityRegime = new SignalVolatilityRegime();
    this.meanReversion = new SignalMeanReversion(snapshotIntervalMs, horizonsSec);
    this.signalSpread = new SignalSpread(bookParser, exchanges);
    this.bookDepth = new SignalBookDepth(bookParser, exchanges);
    this.marketEfficiency = new SignalMarketEfficiency();
    this.crossAssetMomentum = new SignalCrossAssetMomentum(assets);
  }

  /**
   * @section factory
   */

  /**
   * Create a SignalEngine with the default configuration from config.ts.
   */
  public static createDefault(): SignalEngine {
    return new SignalEngine(config.SIGNAL_ASSETS, config.SIGNAL_WINDOWS, config.SNAPSHOT_INTERVAL_MS, config.SIGNAL_HORIZONS_SEC, config.SIGNAL_EXCHANGES);
  }

  /**
   * @section private:methods
   */

  /**
   * @section public:methods
   */

  /**
   * Calculate structured signal result separating asset-level from
   * window-level signals, with price data for display.
   * Asset-level signals are computed once per asset (not duplicated per window).
   */
  public calculateStructured(snapshots: readonly Snapshot[]): StructuredSignalResult {
    const snap = snapshots[snapshots.length - 1];
    const result: Record<string, AssetResult> = {};

    for (let a = 0; a < this.assets.length; a++) {
      const asset = this.assets[a];
      if (asset === undefined) {
        continue;
      }

      const assetSignals = this.calculateAssetSignals(snapshots, asset);
      const chainlinkPrice = this.extractNumber(snap, `${asset}_chainlink_price`);
      const windowResults: Record<string, WindowResult> = {};

      for (let w = 0; w < this.windows.length; w++) {
        const window = this.windows[w];
        if (window === undefined) {
          continue;
        }
        windowResults[window] = this.calculateWindowResult(snapshots, snap, asset, window);
      }

      result[asset] = { chainlinkPrice, signals: assetSignals, windows: windowResults };
    }

    return result;
  }

  /**
   * Calculate asset-level signals (independent of market window).
   */
  private calculateAssetSignals(snapshots: readonly Snapshot[], asset: string): AssetSignals {
    const result: AssetSignals = {
      velocity: this.velocity.calculate(snapshots, asset),
      momentum: this.momentum.calculate(snapshots, asset),
      meanReversion: this.meanReversion.calculate(snapshots, asset),
      oracleLag: this.oracleLag.calculate(snapshots, asset),
      dispersion: this.dispersion.calculate(snapshots, asset),
      imbalance: this.imbalance.calculate(snapshots, asset),
      microprice: this.microprice.calculate(snapshots, asset),
      staleness: this.staleness.calculate(snapshots, asset),
      acceleration: this.acceleration.calculate(snapshots, asset),
      volatilityRegime: this.volatilityRegime.calculate(snapshots, asset),
      spread: this.signalSpread.calculate(snapshots, asset),
      bookDepth: this.bookDepth.calculate(snapshots, asset),
      crossAssetMomentum: this.crossAssetMomentum.calculate(snapshots, asset),
    };

    return result;
  }

  /**
   * Calculate window-level signals and extract price data.
   */
  private calculateWindowResult(snapshots: readonly Snapshot[], snap: Snapshot | undefined, asset: string, window: string): WindowResult {
    const prefix = `${asset}_${window}`;
    const signals: WindowSignals = {
      distance: this.distance.calculate(snapshots, asset, window),
      zScore: this.zScore.calculate(snapshots, asset, window),
      edge: this.edge.calculate(snapshots, asset, window),
      tokenPressure: this.tokenPressure.calculate(snapshots, asset, window),
      marketEfficiency: this.marketEfficiency.calculate(snapshots, asset, window),
    };

    const prices: WindowPriceData = {
      priceToBeat: this.extractNumber(snap, `${prefix}_price_to_beat`),
      upPrice: this.extractNumber(snap, `${prefix}_up_price`),
      downPrice: this.extractNumber(snap, `${prefix}_down_price`),
      marketStartMs: this.extractTimestampMs(snap, `${prefix}_market_start`),
      marketEndMs: this.extractTimestampMs(snap, `${prefix}_market_end`),
    };

    const result: WindowResult = { signals, prices };
    return result;
  }

  /**
   * Safely extract a numeric value from a snapshot field.
   */
  private extractNumber(snap: Snapshot | undefined, key: string): number | null {
    const raw = snap ? (snap[key] ?? null) : null;
    const result = typeof raw === "number" ? raw : null;
    return result;
  }

  /**
   * Extract a timestamp as epoch ms from a snapshot field.
   * Handles both numeric (already ms) and string (ISO date) values.
   */
  private extractTimestampMs(snap: Snapshot | undefined, key: string): number | null {
    const raw = snap ? (snap[key] ?? null) : null;
    const result = typeof raw === "number" ? raw : typeof raw === "string" ? (Number.isFinite(new Date(raw).getTime()) ? new Date(raw).getTime() : null) : null;
    return result;
  }

  /**
   * Recalculate exchange-based signals with custom weights for a specific asset.
   * Returns only the exchange-based signals that can be weighted.
   *
   * @param snapshots - Snapshot array (most recent at end)
   * @param asset - Asset name (e.g., "btc")
   * @param exchangeWeights - Exchange weights [binance, coinbase, kraken, okx]
   * @returns Object containing weighted exchange signals
   */
  public calculateExchangeSignalsWithWeights(
    snapshots: readonly Snapshot[],
    asset: string,
    exchangeWeights: ExchangeWeights,
  ): {
    oracleLag: SignalValue;
    dispersion: SignalValue;
    imbalance: SignalValue;
    microprice: SignalValue;
    staleness: SignalValue;
    spread: SignalValue;
    bookDepth: SignalValue;
  } {
    return {
      oracleLag: this.oracleLag.calculate(snapshots, asset, exchangeWeights),
      dispersion: this.dispersion.calculate(snapshots, asset, exchangeWeights),
      imbalance: this.imbalance.calculate(snapshots, asset, exchangeWeights),
      microprice: this.microprice.calculate(snapshots, asset, exchangeWeights),
      staleness: this.staleness.calculate(snapshots, asset, exchangeWeights),
      spread: this.signalSpread.calculate(snapshots, asset, exchangeWeights),
      bookDepth: this.bookDepth.calculate(snapshots, asset, exchangeWeights),
    };
  }
}
