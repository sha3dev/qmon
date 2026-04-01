import * as assert from "node:assert/strict";
import { test } from "node:test";

import logger from "../src/logger.ts";
import { QmonLiveExecutionService } from "../src/qmon/qmon-live-execution.service.ts";
import type { QmonPendingOrder, QmonPopulation } from "../src/qmon/qmon.types.ts";

function createPendingOrder(market: "eth-5m" | "btc-5m", kind: "entry" | "exit", action: "BUY_UP" | "SELL_UP"): QmonPendingOrder {
  return {
    kind,
    action,
    score: 0.9,
    triggeredBy: ["signal-fill"],
    requestedShares: 5,
    remainingShares: 5,
    limitPrice: 0.38,
    createdAt: 100,
    market,
    marketStartMs: 100,
    marketEndMs: Date.now() + 60_000,
    priceToBeat: 2_000,
    entryDirectionRegime: "flat",
    entryVolatilityRegime: "normal",
    directionalAlpha: 0.9,
    estimatedEdgeBps: 10,
    estimatedNetEvUsd: 0.2,
    predictedSlippageBps: 4,
    predictedFillQuality: 1,
    signalAgreementCount: 2,
    dominantSignalGroup: "predictive",
    tradeabilityRejectReason: null,
  };
}

function createPopulation(
  market: "eth-5m" | "btc-5m",
  pendingOrder: QmonPendingOrder | null,
  action: "BUY_UP" | null,
): QmonPopulation {
  return {
    market,
    qmons: [],
    createdAt: 1,
    lastUpdated: 1,
    activeChampionQmonId: null,
    marketConsolidatedPnl: 0,
    seatPosition: {
      action,
      enteredAt: action === null ? null : 100,
      entryScore: action === null ? null : 0.9,
      entryPrice: action === "BUY_UP" ? 0.38 : null,
      peakReturnPct: null,
      shareCount: action === null ? null : 4.89,
      priceToBeat: action === null ? null : 2_000,
      marketStartMs: action === null ? null : 100,
      marketEndMs: action === null ? null : 200,
      entryTriggers: action === null ? [] : ["signal-fill"],
      entryDirectionRegime: action === null ? null : "flat",
      entryVolatilityRegime: action === null ? null : "normal",
      directionalAlpha: action === null ? null : 0.9,
      estimatedEdgeBps: action === null ? null : 10,
      estimatedNetEvUsd: action === null ? null : 0.2,
      predictedSlippageBps: action === null ? null : 4,
      predictedFillQuality: action === null ? null : 1,
      signalAgreementCount: action === null ? null : 2,
      dominantSignalGroup: action === null ? "none" : "predictive",
    },
    seatPendingOrder: pendingOrder,
    seatLastCloseTimestamp: null,
    seatLastWindowStartMs: 100,
    seatLastSettledWindowStartMs: null,
  };
}

function createSignals(): {
  eth: {
    chainlinkPrice: number;
    signals: Record<string, never>;
    windows: {
      "5m": {
        signals: Record<string, never>;
        prices: {
          priceToBeat: number;
          upPrice: number;
          downPrice: number;
          marketStartMs: number;
          marketEndMs: number;
        };
      };
    };
  };
} {
  return {
    eth: {
      chainlinkPrice: 2_000,
      signals: {},
      windows: {
        "5m": {
          signals: {},
          prices: {
            priceToBeat: 2_000,
            upPrice: 0.38,
            downPrice: 0.62,
            marketStartMs: 100,
            marketEndMs: 200,
          },
        },
      },
    },
  };
}

function createMockMarket(slug: string) {
  return {
    id: slug,
    slug,
    question: slug,
    symbol: "eth",
    conditionId: slug,
    outcomes: ["up", "down"],
    clobTokenIds: ["1", "2"],
    upTokenId: "1",
    downTokenId: "2",
    orderMinSize: 1,
    orderPriceMinTickSize: "0.01",
    eventStartTime: new Date(0).toISOString(),
    endDate: new Date(Date.now() + 60_000).toISOString(),
    start: new Date(Date.now() - 60_000),
    end: new Date(Date.now() + 60_000),
    raw: {},
  };
}

function createMockEngine(initialPopulations: readonly QmonPopulation[]) {
  const populationsByMarket = new Map(initialPopulations.map((population) => [population.market, population]));

  return {
    getPopulation(market: "eth-5m" | "btc-5m") {
      const population = populationsByMarket.get(market) ?? null;
      return population;
    },
    applyRealSeatPendingOrderFill(market: "eth-5m" | "btc-5m", averagePrice: number) {
      const population = populationsByMarket.get(market) ?? null;

      if (population !== null && population.seatPendingOrder !== null) {
        if (population.seatPendingOrder.kind === "entry") {
          populationsByMarket.set(market, createPopulation(market, null, "BUY_UP"));
        } else {
          populationsByMarket.set(market, {
            ...createPopulation(market, null, null),
            marketConsolidatedPnl: averagePrice,
          });
        }
      }
    },
    clearRealSeatPendingOrder(market: "eth-5m" | "btc-5m") {
      const population = populationsByMarket.get(market) ?? null;

      if (population !== null) {
        populationsByMarket.set(market, {
          ...population,
          seatPendingOrder: null,
        });
      }
    },
    getPopulations(): readonly QmonPopulation[] {
      return [...populationsByMarket.values()];
    },
  };
}

function createMockLiveStatePersistence() {
  return {
    load: async () => null,
    save: async () => true,
  };
}

async function captureWarnMessages(callback: () => Promise<void>): Promise<readonly string[]> {
  const warnMessages: string[] = [];
  const mutableLogger = logger as { warn: (...args: readonly unknown[]) => void };
  const originalWarn = mutableLogger.warn;

  mutableLogger.warn = (...args: readonly unknown[]): void => {
    warnMessages.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await callback();
  } finally {
    mutableLogger.warn = originalWarn;
  }

  return warnMessages;
}

test("QmonLiveExecutionService moves posted but unconfirmed orders into recovery without retrying", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 42,
    postOrder: async () => ({
      id: "order-1",
      date: new Date(),
    }),
    waitForOrderConfirmation: async () => ({
      id: "order-1",
      ok: false,
      status: "timeout" as const,
      latency: 1,
      date: new Date(),
      error: {
        message: "Order order-1 timed out after 5000ms.",
      },
    }),
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();

  const status = liveExecutionService.getStatus(engine.getPopulations());
  const ethRoute = status.marketRoutes.find((route) => route.market === "eth-5m") ?? null;

  assert.equal(ethRoute?.executionState, "real-recovery-required");
  assert.equal(ethRoute?.isHalted, true);
  assert.equal(ethRoute?.pendingIntentKey !== null, true);
});

test("QmonLiveExecutionService routes real seat pending orders only for allowlisted markets", async () => {
  const postedOrders: {
    readonly op: string;
    readonly direction: string;
    readonly size: number;
    readonly price: number;
    readonly slug: string;
  }[] = [];
  let balanceReads = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => {
      balanceReads += 1;
      return 42;
    },
    postOrder: async (options: { readonly op: string; readonly direction: string; readonly size: number; readonly price: number; readonly market: { readonly slug: string } }) => {
      postedOrders.push({
        op: options.op,
        direction: options.direction,
        size: options.size,
        price: options.price,
        slug: options.market.slug,
      });

      return {
        ...options,
        id: String(postedOrders.length),
        date: new Date(),
      };
    },
    waitForOrderConfirmation: async (options: { readonly order: { readonly id: string } }) => ({
      id: options.order.id,
      ok: true,
      status: "confirmed" as const,
      latency: 1,
      date: new Date(),
      market: createMockMarket("eth-updown-5m"),
      size: 5,
      price: 0.38,
      op: "buy" as const,
      direction: "up" as const,
    }),
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([
    createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null),
    createPopulation("btc-5m", createPendingOrder("btc-5m", "entry", "BUY_UP"), null),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const populationsAfterEntry = engine.getPopulations().map((population) =>
    population.market === "eth-5m" ? { ...population, seatPendingOrder: createPendingOrder("eth-5m", "exit", "SELL_UP") } : population,
  );
  const exitEngine = createMockEngine(populationsAfterEntry);

  liveExecutionService.queueSync(exitEngine as never, createSignals() as never);
  await liveExecutionService.flush();

  const status = liveExecutionService.getStatus(exitEngine.getPopulations());

  assert.equal(balanceReads >= 2, true);
  assert.equal(postedOrders.length, 2);
  assert.deepEqual(postedOrders.map((order) => `${order.op}:${order.direction}:${order.slug}`), ["buy:up:eth-updown-5m", "sell:up:eth-updown-5m"]);
  assert.equal(status.marketRoutes.find((route) => route.market === "eth-5m")?.route, "real");
  assert.equal(status.marketRoutes.find((route) => route.market === "btc-5m")?.route, "paper");
});

test("QmonLiveExecutionService logs posted and confirmed real orders at warn level", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 42,
    postOrder: async () => ({
      id: "order-1",
      date: new Date(),
    }),
    waitForOrderConfirmation: async () => ({
      id: "order-1",
      ok: true,
      status: "confirmed" as const,
      latency: 1,
      date: new Date(),
      market: createMockMarket("eth-updown-5m"),
      size: 5,
      price: 0.38,
      op: "buy" as const,
      direction: "up" as const,
    }),
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  const warnMessages = await captureWarnMessages(async () => {
    await liveExecutionService.initialize({
      mode: "real",
      allowlistedMarkets: ["eth-5m"],
      privateKey: "0xabc",
      confirmationTimeoutMs: 5_000,
      persistedState: null,
      cpnlSessionStartedAt: null,
    });

    liveExecutionService.queueSync(engine as never, createSignals() as never);
    await liveExecutionService.flush();
  });

  assert.equal(warnMessages.some((message) => message.includes("[real-activity] code=live-order-posted market=eth-5m")), true);
  assert.equal(warnMessages.some((message) => message.includes("[real-activity] code=live-order-confirmed market=eth-5m")), true);
});

test("QmonLiveExecutionService logs recovery-required real orders at warn level", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 42,
    postOrder: async () => ({
      id: "order-1",
      date: new Date(),
    }),
    waitForOrderConfirmation: async () => ({
      id: "order-1",
      ok: false,
      status: "timeout" as const,
      latency: 1,
      date: new Date(),
      error: {
        message: "Order order-1 timed out after 5000ms.",
      },
    }),
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  const warnMessages = await captureWarnMessages(async () => {
    await liveExecutionService.initialize({
      mode: "real",
      allowlistedMarkets: ["eth-5m"],
      privateKey: "0xabc",
      confirmationTimeoutMs: 5_000,
      persistedState: null,
      cpnlSessionStartedAt: null,
    });

    liveExecutionService.queueSync(engine as never, createSignals() as never);
    await liveExecutionService.flush();
  });

  assert.equal(warnMessages.some((message) => message.includes("[real-activity] code=live-order-posted market=eth-5m")), true);
  assert.equal(warnMessages.some((message) => message.includes("[real-activity] code=live-recovery-required market=eth-5m")), true);
});

test("QmonLiveExecutionService clears failed real seat orders and refreshes balance on balance errors", async () => {
  let balanceReads = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => {
      balanceReads += 1;
      return 12;
    },
    postOrder: async () => {
      throw new Error("insufficient balance");
    },
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();

  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(balanceReads, 2);
  assert.equal(status.balanceUsd, 12);
  assert.equal(status.balanceState, "fresh");
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder, null);
  assert.equal(status.marketRoutes[0]?.lastError?.includes("insufficient balance"), true);
});

test("QmonLiveExecutionService keeps recovery-required markets halted on startup", async () => {
  let postCount = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    postOrder: async () => {
      postCount += 1;
      return null;
    },
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: {
      updatedAt: Date.now(),
      markets: [
        {
          market: "eth-5m",
          routeState: "recovery-required",
          pendingIntentKey: "eth-5m:entry:BUY_UP:100:5.000000:0.380000",
          submittedAt: 100,
          orderId: "1",
          confirmedLiveSeat: null,
          lastError: "restart with unresolved intent",
        },
      ],
    },
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(postCount, 0);
  assert.equal(status.marketRoutes[0]?.executionState, "real-recovery-required");
  assert.equal(status.marketRoutes[0]?.isHalted, true);
});

test("QmonLiveExecutionService halts a market when a new entry appears while a confirmed live position already exists", async () => {
  let postCount = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    postOrder: async () => {
      postCount += 1;
      return null;
    },
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: {
      updatedAt: Date.now(),
      markets: [
        {
          market: "eth-5m",
          routeState: "armed",
          pendingIntentKey: null,
          submittedAt: null,
          orderId: null,
          confirmedLiveSeat: {
            action: "BUY_UP",
            shareCount: 5,
            entryPrice: 0.38,
            enteredAt: 100,
          },
          lastError: null,
        },
      ],
    },
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(postCount, 0);
  assert.equal(status.marketRoutes[0]?.executionState, "real-halted");
  assert.equal(status.marketRoutes[0]?.isHalted, true);
});

test("QmonLiveExecutionService does not infer a confirmed live position from local seat state alone", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    postOrder: async () => null,
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", null, "BUY_UP")]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(status.marketRoutes[0]?.hasLivePosition, false);
  assert.equal(status.marketRoutes[0]?.confirmedLiveSeat, null);
});

test("QmonLiveExecutionService halts when a confirmed live order is missing a traceable order id", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    postOrder: async (options: { readonly market: { readonly slug: string } }) => ({
      ...options,
      date: new Date(),
    }),
    waitForOrderConfirmation: async () => ({
      ok: true,
      status: "confirmed" as const,
      latency: 1,
      date: new Date(),
      market: createMockMarket("eth-updown-5m"),
      size: 5,
      price: 0.38,
      op: "buy" as const,
      direction: "up" as const,
    }),
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m")],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([createPopulation("eth-5m", createPendingOrder("eth-5m", "entry", "BUY_UP"), null)]);

  await liveExecutionService.initialize({
    mode: "real",
    allowlistedMarkets: ["eth-5m"],
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(status.marketRoutes[0]?.executionState, "real-halted");
  assert.equal(status.marketRoutes[0]?.confirmedLiveSeat, null);
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder, null);
});
