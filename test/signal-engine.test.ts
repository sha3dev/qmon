import * as assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Snapshot } from "@sha3/polymarket-snapshot";
import { SignalEngine } from "../src/index.ts";

function createSnapshot(generatedAt: number, fields: Record<string, number | string | null>): Snapshot {
  return {
    generated_at: generatedAt,
    ...fields,
  } as Snapshot;
}

function createSnapshotSeries(count: number, chainlinkPrices: readonly number[]): readonly Snapshot[] {
  const snapshots: Snapshot[] = [];

  for (let index = 0; index < count; index += 1) {
    const generatedAt = 1_700_000_000_000 + index * 500;
    const chainlinkPrice = chainlinkPrices[index] ?? chainlinkPrices[chainlinkPrices.length - 1] ?? 60_000;

    snapshots.push(
      createSnapshot(generatedAt, {
        btc_chainlink_price: chainlinkPrice,
        btc_chainlink_event_ts: generatedAt - 50,
        btc_binance_price: chainlinkPrice + 40,
        btc_coinbase_price: chainlinkPrice - 35,
        btc_binance_event_ts: generatedAt - 20,
        btc_coinbase_event_ts: generatedAt - 25,
        btc_5m_price_to_beat: 60_000,
        btc_5m_up_price: 0.42,
        btc_5m_down_price: 0.58,
        btc_5m_market_start: new Date(generatedAt - 60_000).toISOString(),
        btc_5m_market_end: new Date(generatedAt + 240_000).toISOString(),
      }),
    );
  }

  return snapshots;
}

describe("SignalEngine", () => {
  const signalEngine = new SignalEngine(["btc"], ["5m"], 500, [30, 120, 300], ["binance", "coinbase"]);

  test("returns structured placeholders when no snapshots are available", () => {
    const structuredSignals = signalEngine.calculateStructured([]);
    const btcSignals = structuredSignals.btc;
    const btcWindow = btcSignals?.windows["5m"];

    assert.ok(btcSignals);
    assert.ok(btcWindow);
    assert.equal(btcSignals.chainlinkPrice, null);
    assert.equal(btcSignals.signals.oracleLag, null);
    assert.equal(btcWindow.signals.distance, null);
    assert.equal(btcWindow.prices.priceToBeat, null);
  });

  test("computes asset-level and window-level values in the structured payload", () => {
    const structuredSignals = signalEngine.calculateStructured(
      createSnapshotSeries(
        80,
        Array.from({ length: 80 }, (_, index) => 60_000 + index * 4),
      ),
    );
    const btcSignals = structuredSignals.btc;
    const btcWindow = btcSignals?.windows["5m"];

    assert.ok(btcSignals);
    assert.ok(btcWindow);
    assert.equal(typeof btcSignals.chainlinkPrice, "number");
    assert.equal(typeof btcSignals.signals.oracleLag, "number");
    assert.equal(typeof btcSignals.signals.dispersion, "number");
    assert.equal(typeof btcSignals.signals.velocity["30s"], "number");
    assert.equal(typeof btcWindow.signals.distance, "number");
    assert.equal(typeof btcWindow.signals.zScore, "number");
    assert.equal(typeof btcWindow.prices.marketEndMs, "number");
  });

  test("keeps computed normalized signals in the expected range", () => {
    const structuredSignals = signalEngine.calculateStructured(
      createSnapshotSeries(
        120,
        Array.from({ length: 120 }, (_, index) => 60_000 + index * 1.5 + Math.sin(index / 5) * 10),
      ),
    );
    const btcSignals = structuredSignals.btc;
    const btcWindow = btcSignals?.windows["5m"];
    const normalizedValues = [
      btcSignals?.signals.oracleLag,
      btcSignals?.signals.dispersion,
      btcSignals?.signals.microprice,
      btcSignals?.signals.staleness,
      btcWindow?.signals.distance,
      btcWindow?.signals.zScore,
      btcWindow?.signals.edge,
    ].filter((value): value is number => typeof value === "number");

    assert.ok(normalizedValues.length > 0);
    assert.equal(
      normalizedValues.every((value) => value >= -1 && value <= 1),
      true,
    );
  });
});
