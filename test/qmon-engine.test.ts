import * as assert from "node:assert/strict";
import { test } from "node:test";

import { QmonEngine } from "../src/qmon/qmon-engine.service.ts";
import type { RegimeResult } from "../src/regime/regime.types.ts";
import type { StructuredSignalResult } from "../src/signal/signal.types.ts";

function createStructuredSignals(options: {
  readonly generatedAt: number;
  readonly marketStartMs: number;
  readonly marketEndMs: number;
  readonly upPrice: number;
  readonly downPrice: number;
  readonly priceToBeat: number;
  readonly chainlinkPrice: number;
}): StructuredSignalResult {
  return {
    btc: {
      chainlinkPrice: options.chainlinkPrice,
      signals: {
        velocity: { "30s": 0, "2m": 0, "5m": 0 },
        momentum: { "30s": 0, "2m": 0, "5m": 0 },
        meanReversion: { "30s": 0, "2m": 0, "5m": 0 },
        oracleLag: 0,
        dispersion: 0,
        imbalance: 0,
        microprice: 0,
        staleness: 0,
        acceleration: 0,
        volatilityRegime: 0,
        spread: 0,
        bookDepth: 0,
        crossAssetMomentum: 0,
      },
      windows: {
        "5m": {
          signals: {
            distance: 0,
            zScore: 0,
            edge: 0,
            tokenPressure: 0,
            marketEfficiency: 0,
          },
          prices: {
            priceToBeat: options.priceToBeat,
            upPrice: options.upPrice,
            downPrice: options.downPrice,
            marketStartMs: options.marketStartMs,
            marketEndMs: options.marketEndMs,
          },
        },
      },
    },
  };
}

function createRegimes(direction: "trending-up" | "trending-down" | "flat"): RegimeResult {
  return {
    btc: {
      direction,
      volatility: "normal",
      directionStrength: 1,
      volatilityLevel: 0.5,
      lastUpdated: 1,
    },
  };
}

test("late trend reverse opens only on the first flip inside the late zone", () => {
  const qmonEngine = QmonEngine.createDefault(["btc"], ["5m"]);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 100,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.4,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 100_010,
    }),
    createRegimes("trending-up"),
    80,
  );

  let qmon = qmonEngine.getFamilyState().populations[0]?.qmons[0];

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, null);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 101,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.4,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 99_990,
    }),
    createRegimes("trending-down"),
    95,
  );

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons[0];

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, "BUY_DOWN");
  assert.equal(qmon.paperPosition.shareCount, 5);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 102,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.4,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 100_100,
    }),
    createRegimes("trending-up"),
    97,
  );

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons[0];

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, "BUY_DOWN");
  assert.equal(qmon.strategyState.hasTriggeredThisWindow, true);
});

test("late trend reverse settles at rollover and activates the market champion on positive recent pnl", () => {
  const qmonEngine = QmonEngine.createDefault(["btc"], ["5m"]);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 200,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.4,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 100_010,
    }),
    createRegimes("trending-up"),
    89,
  );
  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 201,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.4,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 99_990,
    }),
    createRegimes("trending-down"),
    95,
  );
  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 202,
      marketStartMs: 100,
      marketEndMs: 200,
      upPrice: 0.3,
      downPrice: 0.7,
      priceToBeat: 100_000,
      chainlinkPrice: 99_900,
    }),
    createRegimes("trending-down"),
    105,
  );

  const population = qmonEngine.getFamilyState().populations[0];
  const qmon = population?.qmons[0];

  assert.ok(population);
  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, null);
  assert.equal(qmon.metrics.totalTrades, 1);
  assert.equal(qmon.metrics.recentWindowPnls.at(-1), 4);
  assert.equal(qmon.metrics.recentWindowPnlSum, 4);
  assert.equal(qmon.metrics.isActive, true);
  assert.equal(population.activeChampionQmonId, qmon.id);
});

test("market has no champion when the last five window pnl sum is not positive", () => {
  const qmonEngine = QmonEngine.createDefault(["btc"], ["5m"]);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 300,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.8,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 99_900,
    }),
    createRegimes("trending-down"),
    89,
  );
  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 301,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.8,
      downPrice: 0.2,
      priceToBeat: 100_000,
      chainlinkPrice: 100_100,
    }),
    createRegimes("trending-up"),
    95,
  );
  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 302,
      marketStartMs: 100,
      marketEndMs: 200,
      upPrice: 0.4,
      downPrice: 0.6,
      priceToBeat: 100_000,
      chainlinkPrice: 99_900,
    }),
    createRegimes("trending-down"),
    105,
  );

  const population = qmonEngine.getFamilyState().populations[0];
  const qmon = population?.qmons[0];

  assert.ok(population);
  assert.ok(qmon);
  assert.equal(qmon.metrics.recentWindowPnlSum < 0, true);
  assert.equal(qmon.metrics.isActive, false);
  assert.equal(population.activeChampionQmonId, null);
});
