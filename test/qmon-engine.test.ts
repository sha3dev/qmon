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

  let qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-reverse");

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

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-reverse");

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

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-reverse");

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
  const qmon = population?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-reverse");

  assert.ok(population);
  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, null);
  assert.equal(qmon.metrics.totalTrades, 1);
  assert.equal(qmon.metrics.recentWindowPnls.at(-1), 4);
  assert.equal(qmon.metrics.recentWindowPnlSum, 4);
  assert.equal(qmon.metrics.isActive, true);
  assert.equal(population.activeChampionQmonId, qmon.id);
});

test("champion selection can move to the better preset when late trend reverse is negative", () => {
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
  const lateTrendReverseQmon = population?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-reverse");
  const cheapTrendQmon = population?.qmons.find((candidateQmon) => candidateQmon.strategyId === "mid-window-cheap-trend-x2");

  assert.ok(population);
  assert.ok(lateTrendReverseQmon);
  assert.ok(cheapTrendQmon);
  assert.equal(lateTrendReverseQmon.metrics.recentWindowPnlSum < 0, true);
  assert.equal(lateTrendReverseQmon.metrics.isActive, false);
  assert.equal(cheapTrendQmon.metrics.isActive, true);
  assert.equal(population.activeChampionQmonId, cheapTrendQmon.id);
});

test("mid window cheap trend x2 buys the cheap trend token after 50% and exits on x2", () => {
  const qmonEngine = QmonEngine.createDefault(["btc"], ["5m"]);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 400,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.18,
      downPrice: 0.82,
      priceToBeat: 100_000,
      chainlinkPrice: 100_100,
    }),
    createRegimes("trending-up"),
    60,
  );

  let qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "mid-window-cheap-trend-x2");

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, "BUY_UP");
  assert.equal(qmon.paperPosition.shareCount, 6);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 401,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.36,
      downPrice: 0.64,
      priceToBeat: 100_000,
      chainlinkPrice: 100_120,
    }),
    createRegimes("trending-up"),
    70,
  );

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "mid-window-cheap-trend-x2");

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, null);
  assert.equal(qmon.metrics.totalTrades, 1);
  assert.equal(qmon.currentWindowPnl > 1, true);
});

test("late trend band entry buys only in the last quarter when the trend token stays inside the 0.60 to 0.80 band", () => {
  const qmonEngine = QmonEngine.createDefault(["btc"], ["5m"]);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 500,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.7,
      downPrice: 0.3,
      priceToBeat: 100_000,
      chainlinkPrice: 100_100,
    }),
    createRegimes("trending-up"),
    74,
  );

  let qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-band-entry");

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, null);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 501,
      marketStartMs: 0,
      marketEndMs: 100,
      upPrice: 0.7,
      downPrice: 0.3,
      priceToBeat: 100_000,
      chainlinkPrice: 100_120,
    }),
    createRegimes("trending-up"),
    76,
  );

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-band-entry");

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, "BUY_UP");
  assert.equal(qmon.paperPosition.shareCount, 5);

  qmonEngine.evaluateAll(
    createStructuredSignals({
      generatedAt: 502,
      marketStartMs: 100,
      marketEndMs: 200,
      upPrice: 0.4,
      downPrice: 0.6,
      priceToBeat: 100_000,
      chainlinkPrice: 100_200,
    }),
    createRegimes("trending-up"),
    105,
  );

  qmon = qmonEngine.getFamilyState().populations[0]?.qmons.find((candidateQmon) => candidateQmon.strategyId === "late-trend-band-entry");

  assert.ok(qmon);
  assert.equal(qmon.paperPosition.action, null);
  assert.equal(qmon.metrics.totalTrades, 1);
  assert.equal(qmon.metrics.recentWindowPnls.at(-1), 1.5);
});
