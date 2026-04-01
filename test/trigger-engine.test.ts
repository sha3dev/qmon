import * as assert from "node:assert/strict";
import { test } from "node:test";

import { TriggerEngine } from "../src/index.ts";
import type { StructuredSignalResult } from "../src/index.ts";

function buildStructuredResult(options: {
  upPrice: number;
  distance: number;
  edge: number;
  imbalance: number;
  marketStartMs?: number;
  marketEndMs?: number;
}): StructuredSignalResult {
  const marketStartMs = options.marketStartMs ?? 1_700_000_000_000;
  const marketEndMs = options.marketEndMs ?? marketStartMs + 300_000;

  const result: StructuredSignalResult = {
    btc: {
      chainlinkPrice: 60_000,
      signals: {
        velocity: { "30s": 0.1, "2m": 0.1, "5m": 0.1 },
        momentum: { "30s": 0.2, "2m": 0.2, "5m": 0.2 },
        meanReversion: { "30s": 0.1, "2m": 0.1, "5m": 0.1 },
        oracleLag: 0.1,
        dispersion: 0.05,
        imbalance: options.imbalance,
        microprice: 0.1,
        staleness: 0.1,
        acceleration: 0.1,
        volatilityRegime: 0.1,
        spread: 0.1,
        bookDepth: 0.1,
        crossAssetMomentum: 0.1,
      },
      windows: {
        "5m": {
          signals: {
            distance: options.distance,
            zScore: 0.1,
            edge: options.edge,
            tokenPressure: 0.1,
            marketEfficiency: 0.1,
          },
          prices: {
            priceToBeat: 60_000,
            upPrice: options.upPrice,
            downPrice: 1 - options.upPrice,
            marketStartMs,
            marketEndMs,
          },
        },
      },
    },
  };

  return result;
}

test("TriggerEngine fires triggers only on threshold transitions", () => {
  const triggerEngine = new TriggerEngine();

  const baseline = buildStructuredResult({
    upPrice: 0.45,
    distance: 0.2,
    edge: 0.2,
    imbalance: 0.2,
  });
  const crossed = buildStructuredResult({
    upPrice: 0.55,
    distance: 0.6,
    edge: 0.5,
    imbalance: 0.6,
  });

  const firstTriggers = triggerEngine.evaluate(baseline);
  const secondTriggers = triggerEngine.evaluate(crossed);
  const thirdTriggers = triggerEngine.evaluate(crossed);

  assert.deepEqual(firstTriggers, []);
  assert.deepEqual(secondTriggers.map((trigger) => trigger.id).sort(), ["book-pressure", "breakout", "consensus-flip", "mispricing"]);
  assert.deepEqual(thirdTriggers, []);
});
