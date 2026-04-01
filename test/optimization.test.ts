import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceRuntime } from "../src/app/service-runtime.service.ts";
import { HttpServerService } from "../src/http/http-server.service.ts";
import { QmonReplayHistoryService } from "../src/qmon/qmon-replay-history.service.ts";
import { SignalBookParser } from "../src/signal/signal-book-parser.service.ts";

test("SignalBookParser caches repeated parse and best-bid-ask lookups", () => {
  const signalBookParser = new SignalBookParser();
  const originalJsonParse = JSON.parse;
  let parseCount = 0;

  JSON.parse = ((text: string) => {
    parseCount += 1;
    return originalJsonParse(text);
  }) as typeof JSON.parse;

  try {
    const orderBookJson = JSON.stringify({
      bids: [{ price: 0.45, size: 10 }],
      asks: [{ price: 0.55, size: 12 }],
    });

    signalBookParser.parse(orderBookJson);
    signalBookParser.parse(orderBookJson);
    signalBookParser.parseAndBest(orderBookJson);
    signalBookParser.parseAndBest(orderBookJson);

    assert.equal(parseCount, 1);
  } finally {
    JSON.parse = originalJsonParse;
  }
});

test("QmonReplayHistoryService reuses the hydration tape inside one live window and advances it on window rollover", () => {
  const replayHistoryService = new QmonReplayHistoryService(2);
  const firstSnapshot = { generated_at: 1 } as const;
  const secondSnapshot = { generated_at: 2 } as const;
  const thirdSnapshot = { generated_at: 3 } as const;
  const firstWindowSignals = {
    eth: {
      chainlinkPrice: 2_000,
      signals: {} as Record<string, never>,
      windows: {
        "5m": {
          signals: {} as Record<string, never>,
          prices: {
            priceToBeat: 2_000,
            upPrice: 0.4,
            downPrice: 0.6,
            marketStartMs: 100,
            marketEndMs: 200,
          },
        },
      },
    },
  };
  const secondWindowSignals = {
    eth: {
      chainlinkPrice: 2_000,
      signals: {} as Record<string, never>,
      windows: {
        "5m": {
          signals: {} as Record<string, never>,
          prices: {
            priceToBeat: 2_000,
            upPrice: 0.45,
            downPrice: 0.55,
            marketStartMs: 300,
            marketEndMs: 400,
          },
        },
      },
    },
  };

  replayHistoryService.recordSnapshot(firstSnapshot as never, firstWindowSignals as never);

  const firstTape = replayHistoryService.buildHydrationSnapshotTape("eth-5m");

  replayHistoryService.recordSnapshot(secondSnapshot as never, firstWindowSignals as never);

  const secondTape = replayHistoryService.buildHydrationSnapshotTape("eth-5m");

  replayHistoryService.recordSnapshot(thirdSnapshot as never, secondWindowSignals as never);

  const thirdTape = replayHistoryService.buildHydrationSnapshotTape("eth-5m");

  assert.equal(firstTape, secondTape);
  assert.deepEqual(firstTape, [firstSnapshot]);
  assert.deepEqual(thirdTape, [firstSnapshot, secondSnapshot, thirdSnapshot]);
});

test("HttpServerService serves structured signals without using the removed legacy calculate path", async () => {
  const structuredSignals = {
    btc: {
      chainlinkPrice: 100_000,
      signals: {
        velocity: { "30s": 0.1, "2m": 0.2, "5m": 0.3 },
        momentum: { "30s": 0.2, "2m": 0.1, "5m": 0 },
        meanReversion: { "30s": 0, "2m": 0, "5m": 0 },
        oracleLag: 0.4,
        dispersion: 0.5,
        imbalance: 0.6,
        microprice: 0.7,
        staleness: 0.8,
        acceleration: 0.9,
        volatilityRegime: 0.1,
        spread: 0.2,
        bookDepth: 0.3,
        crossAssetMomentum: 0.4,
      },
      windows: {
        "5m": {
          signals: {
            distance: 0.11,
            zScore: 0.22,
            edge: 0.33,
            tokenPressure: 0.44,
            marketEfficiency: 0.55,
          },
          prices: {
            priceToBeat: 100_000,
            upPrice: 0.4,
            downPrice: 0.6,
            marketStartMs: 1,
            marketEndMs: 2,
          },
        },
      },
    },
  };
  const fakeSignalEngine = {
    calculateStructured: () => structuredSignals,
  };
  const fakeTriggerEngine = {
    evaluate: () => [],
  };
  const fakeRegimeEngine = {
    evaluate: () => ({ states: {}, events: [] }),
  };
  const httpServerService = new HttpServerService(fakeSignalEngine as never, fakeTriggerEngine as never, fakeRegimeEngine as never);
  const server = httpServerService.buildServer();

  httpServerService.updateSignals([{ generated_at: 1 }]);

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/signals/structured`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.btc.windows["5m"].signals.distance, 0.11);
  assert.equal(json.btc.signals.oracleLag, 0.4);
  assert.equal(json.btc.signals.bookDepth, 0.3);
  assert.deepEqual(json.triggers, []);

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(undefined);
    });
  });
});

test("ServiceRuntime persists immediately for critical mutations and batches non-critical ones", async () => {
  let saveCount = 0;
  const fakeQmonEngine = {
    consumeMutationState: () => ({ hasStateMutation: true, hasCriticalMutation: false }),
    getFamilyState: () => ({ populations: [] }),
  };
  const fakeQmonPersistence = {
    save: async () => {
      saveCount += 1;
      return true;
    },
  };
  const serviceRuntime = new ServiceRuntime({} as never, {} as never, fakeQmonEngine as never, fakeQmonPersistence as never, {} as never);
  const originalDateNow = Date.now;
  let currentNow = 1_000;

  Date.now = () => currentNow;

  try {
    await (serviceRuntime as unknown as { persistFamilyState(shouldPersist: boolean): Promise<void> }).persistFamilyState(true);
    assert.equal(saveCount, 1);

    currentNow += 500;
    await (serviceRuntime as unknown as { persistFamilyState(shouldPersist: boolean): Promise<void> }).persistFamilyState(true);
    assert.equal(saveCount, 1);
  } finally {
    Date.now = originalDateNow;
  }
});

test("ServiceRuntime persists critical mutations immediately even without checkpoint", async () => {
  let saveCount = 0;
  const mutationStates = [
    { hasStateMutation: true, hasCriticalMutation: false },
    { hasStateMutation: true, hasCriticalMutation: true },
  ];
  const fakeQmonEngine = {
    consumeMutationState: () => mutationStates.shift() ?? { hasStateMutation: false, hasCriticalMutation: false },
    getFamilyState: () => ({ populations: [] }),
  };
  const fakeQmonPersistence = {
    save: async () => {
      saveCount += 1;
      return true;
    },
  };
  const serviceRuntime = new ServiceRuntime({} as never, {} as never, fakeQmonEngine as never, fakeQmonPersistence as never, {} as never);
  const originalDateNow = Date.now;
  let currentNow = 5_000;

  Date.now = () => currentNow;

  try {
    await (serviceRuntime as unknown as { persistFamilyState(shouldPersist: boolean): Promise<void> }).persistFamilyState(true);
    assert.equal(saveCount, 1);

    currentNow += 500;
    await (serviceRuntime as unknown as { persistFamilyState(shouldPersist: boolean): Promise<void> }).persistFamilyState(true);
    assert.equal(saveCount, 2);
  } finally {
    Date.now = originalDateNow;
  }
});
