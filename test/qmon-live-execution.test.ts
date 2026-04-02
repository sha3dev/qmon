import * as assert from "node:assert/strict";
import { test } from "node:test";

import logger from "../src/logger.ts";
import { QmonLiveExecutionService } from "../src/qmon/qmon-live-execution.service.ts";
import type { QmonExecutionRuntime, QmonPendingOrder, QmonPopulation } from "../src/qmon/qmon.types.ts";

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
  executionRuntime?: QmonExecutionRuntime,
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
    executionRuntime:
      executionRuntime ??
      {
        route: "paper",
        executionState: "paper",
        pendingIntent: null,
        orderId: null,
        submittedAt: null,
        confirmedVenueSeat: null,
        pendingVenueOrders: [],
        recoveryStartedAt: null,
        lastReconciledAt: null,
        lastError: null,
        isHalted: false,
      },
  };
}

function createRealExecutionRuntime(
  overrides: Partial<QmonExecutionRuntime> = {},
): QmonExecutionRuntime {
  const executionRuntime: QmonExecutionRuntime = {
    route: "real",
    executionState: "real-armed",
    pendingIntent: null,
    orderId: null,
    submittedAt: null,
    confirmedVenueSeat: null,
    pendingVenueOrders: [],
    recoveryStartedAt: null,
    lastReconciledAt: null,
    lastError: null,
    isHalted: false,
    ...overrides,
  };

  return executionRuntime;
}

function createSignals(
  marketStartMs = 100,
  marketEndMs = 200,
): {
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
            marketStartMs,
            marketEndMs,
          },
        },
      },
    },
  };
}

function createMockMarket(slug: string, orderMinSize = 1) {
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
    orderMinSize,
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
          populationsByMarket.set(
            market,
            createPopulation(market, null, "BUY_UP", {
              ...(population.executionRuntime ?? createRealExecutionRuntime()),
              route: "real",
              executionState: "real-open",
              pendingIntent: null,
              confirmedVenueSeat: {
                action: "BUY_UP",
                shareCount: 4.89,
                entryPrice: averagePrice,
                enteredAt: 100,
              },
              isHalted: false,
              recoveryStartedAt: null,
              lastError: null,
            }),
          );
        } else {
          populationsByMarket.set(market, {
            ...createPopulation(market, null, null, {
              ...(population.executionRuntime ?? createRealExecutionRuntime()),
              route: "real",
              executionState: "real-armed",
              pendingIntent: null,
              confirmedVenueSeat: null,
              isHalted: false,
              recoveryStartedAt: null,
              lastError: null,
            }),
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
    clearRealSeatDustPosition(market: "eth-5m" | "btc-5m") {
      const population = populationsByMarket.get(market) ?? null;

      if (population !== null) {
        populationsByMarket.set(market, {
          ...population,
          seatPosition: {
            ...population.seatPosition,
            action: null,
            enteredAt: null,
            entryScore: null,
            entryPrice: null,
            peakReturnPct: null,
            shareCount: null,
            priceToBeat: null,
            marketStartMs: null,
            marketEndMs: null,
            entryTriggers: [],
            entryDirectionRegime: null,
            entryVolatilityRegime: null,
            directionalAlpha: null,
            estimatedEdgeBps: null,
            estimatedNetEvUsd: null,
            predictedSlippageBps: null,
            predictedFillQuality: null,
            signalAgreementCount: null,
            dominantSignalGroup: "none",
          },
          seatPendingOrder: null,
          seatLastCloseTimestamp: 100,
        });
      }
    },
    setRealExecutionRuntime(market: "eth-5m" | "btc-5m", executionRuntime: QmonExecutionRuntime) {
      const population = populationsByMarket.get(market) ?? null;

      if (population !== null) {
        populationsByMarket.set(market, {
          ...population,
          executionRuntime,
        });
      }
    },
    getPopulations(): readonly QmonPopulation[] {
      return [...populationsByMarket.values()];
    },
    getFamilyState() {
      return {
        populations: [...populationsByMarket.values()],
      };
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
  let pendingConfirmationReads = 0;
  let postCount = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 42,
    listActiveOrdersPendingConfirmation: async () => {
      pendingConfirmationReads += 1;

      return pendingConfirmationReads > 1 ? [{ id: "order-1", market: "eth-updown-5m", status: "pending", side: "buy", outcome: "up" }] : [];
    },
    cancelOrderById: async () => true,
    postOrder: async () => ({
      id: `order-${(postCount += 1)}`,
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

  assert.equal(postCount, 1);
  assert.equal(ethRoute?.executionState, "real-recovery-required");
  assert.equal(ethRoute?.isHalted, true);
  assert.equal(ethRoute?.pendingIntentKey !== null, true);
  assert.equal(ethRoute?.orderId, "order-1");
});

test("QmonLiveExecutionService routes all markets through real execution when real mode is enabled", async () => {
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
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
    loadCryptoWindowMarkets: async (options: { readonly symbols: readonly string[] }) => {
      if (options.symbols[0] === "btc") {
        return [createMockMarket("btc-updown-5m")];
      }

      return [createMockMarket("eth-updown-5m")];
    },
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
  assert.equal(postedOrders.length, 3);
  assert.deepEqual(postedOrders.map((order) => `${order.op}:${order.direction}:${order.slug}`), [
    "buy:up:eth-updown-5m",
    "buy:up:btc-updown-5m",
    "sell:up:eth-updown-5m",
  ]);
  assert.equal(status.marketRoutes.find((route) => route.market === "eth-5m")?.route, "real");
  assert.equal(status.marketRoutes.find((route) => route.market === "btc-5m")?.route, "real");
});

test("QmonLiveExecutionService logs posted and confirmed real orders at warn level", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 42,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
    listActiveOrdersPendingConfirmation: async () => [{ id: "1", market: "eth-updown-5m", status: "pending", side: "buy", outcome: "up" }],
    cancelOrderById: async () => true,
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      createPendingOrder("eth-5m", "entry", "BUY_UP"),
      null,
      createRealExecutionRuntime({
        executionState: "real-recovery-required",
        pendingIntent: createPendingOrder("eth-5m", "entry", "BUY_UP"),
        orderId: "1",
        submittedAt: 100,
        recoveryStartedAt: 100,
        isHalted: true,
        lastError: "restart with unresolved intent",
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(postCount, 0);
  assert.equal(status.marketRoutes[0]?.executionState, "real-recovery-required");
  assert.equal(status.marketRoutes[0]?.isHalted, true);
});

test("QmonLiveExecutionService cancels stale open venue orders only after the local intent has expired", async () => {
  const expiredPendingOrder: QmonPendingOrder = {
    ...createPendingOrder("eth-5m", "entry", "BUY_UP"),
    marketEndMs: Date.now() - 5_000,
  };
  const cancelledOrderIds: string[] = [];
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [{ id: "stale-1", market: "eth-updown-5m", status: "pending", side: "buy", outcome: "up" }],
    cancelOrderById: async (orderId: string) => {
      cancelledOrderIds.push(orderId);
      return true;
    },
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      expiredPendingOrder,
      null,
      createRealExecutionRuntime({
        executionState: "real-recovery-required",
        pendingIntent: expiredPendingOrder,
        orderId: "stale-1",
        submittedAt: 100,
        recoveryStartedAt: 100,
        isHalted: true,
        lastError: "timeout while waiting for confirmation",
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();

  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.deepEqual(cancelledOrderIds, ["stale-1"]);
  assert.equal(status.marketRoutes[0]?.executionState, "real-halted");
  assert.equal(status.marketRoutes[0]?.orderId, null);
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder, null);
});

test("QmonLiveExecutionService rechecks a disappeared tracked order before halting and restores the confirmed seat", async () => {
  let confirmationChecks = 0;
  const trackedPendingOrder = createPendingOrder("eth-5m", "entry", "BUY_UP");
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => null,
    reconcileOrderStatus: async () => {
      confirmationChecks += 1;
      return "confirmed" as const;
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      trackedPendingOrder,
      null,
      createRealExecutionRuntime({
        executionState: "real-recovery-required",
        pendingIntent: trackedPendingOrder,
        orderId: "late-fill-1",
        submittedAt: 100,
        recoveryStartedAt: 100,
        isHalted: true,
        lastError: "Order late-fill-1 timed out after 5000ms.",
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();

  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(confirmationChecks, 1);
  assert.equal(status.marketRoutes[0]?.executionState, "real-open");
  assert.equal(status.marketRoutes[0]?.isHalted, false);
  assert.equal(status.marketRoutes[0]?.orderId, null);
  assert.equal(status.marketRoutes[0]?.confirmedLiveSeat?.action, "BUY_UP");
});

test("QmonLiveExecutionService logs reconciliation progress for timed out tracked orders", async () => {
  const trackedPendingOrder = createPendingOrder("eth-5m", "entry", "BUY_UP");
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => null,
    reconcileOrderStatus: async () => "pending" as const,
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      trackedPendingOrder,
      null,
      createRealExecutionRuntime({
        executionState: "real-recovery-required",
        pendingIntent: trackedPendingOrder,
        orderId: "pending-1",
        submittedAt: 100,
        recoveryStartedAt: 100,
        isHalted: true,
        lastError: "Order pending-1 timed out after 5000ms.",
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  const warnMessages = await captureWarnMessages(async () => {
    liveExecutionService.queueSync(engine as never, createSignals() as never);
    await liveExecutionService.flush();
  });

  assert.equal(warnMessages.some((message) => message.includes("[real-activity] code=live-reconcile-started market=eth-5m")), true);
  assert.equal(warnMessages.some((message) => message.includes("[real-activity] code=live-reconcile-pending market=eth-5m")), true);
});

test("QmonLiveExecutionService clears ambiguous disappeared tracked orders so the halt is not retried forever", async () => {
  const trackedPendingOrder = createPendingOrder("eth-5m", "entry", "BUY_UP");
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => null,
    reconcileOrderStatus: async () => "failed" as const,
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      trackedPendingOrder,
      null,
      createRealExecutionRuntime({
        executionState: "real-recovery-required",
        pendingIntent: trackedPendingOrder,
        orderId: "missing-1",
        submittedAt: 100,
        recoveryStartedAt: 100,
        isHalted: true,
        lastError: "Order missing-1 timed out after 5000ms.",
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
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

  assert.equal(status.marketRoutes[0]?.executionState, "real-error");
  assert.equal(status.marketRoutes[0]?.isHalted, false);
  assert.equal(status.marketRoutes[0]?.orderId, null);
  assert.equal(status.marketRoutes[0]?.hasPendingIntent, false);
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder, null);
});

test("QmonLiveExecutionService halts a market when a new entry appears while a confirmed live position already exists", async () => {
  let postCount = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      createPendingOrder("eth-5m", "entry", "BUY_UP"),
      null,
      createRealExecutionRuntime({
        executionState: "real-open",
        confirmedVenueSeat: {
          action: "BUY_UP",
          shareCount: 5,
          entryPrice: 0.38,
          enteredAt: 100,
        },
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
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
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder?.kind, "entry");
});

test("QmonLiveExecutionService halts tiny live exit orders before posting below market minimum size", async () => {
  let postCount = 0;
  const tinyExitOrder: QmonPendingOrder = {
    ...createPendingOrder("eth-5m", "exit", "SELL_UP"),
    requestedShares: 0.0523,
    remainingShares: 0.0523,
  };
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => {
      postCount += 1;
      return null;
    },
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m", 1)],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      tinyExitOrder,
      "BUY_UP",
      createRealExecutionRuntime({
        executionState: "real-open",
        confirmedVenueSeat: {
          action: "BUY_UP",
          shareCount: 0.0523,
          entryPrice: 0.38,
          enteredAt: 100,
        },
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(postCount, 0);
  assert.equal(status.marketRoutes[0]?.executionState, "real-halted");
  assert.equal(status.marketRoutes[0]?.isHalted, true);
  assert.equal(status.marketRoutes[0]?.lastError?.includes("below market minimum size"), true);
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder?.requestedShares, 0.0523);
});

test("QmonLiveExecutionService clears residual exit dust after a confirmed sell fill", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => ({
      id: "exit-1",
      date: new Date(),
    }),
    waitForOrderConfirmation: async () => ({
      id: "exit-1",
      ok: true,
      status: "confirmed" as const,
      latency: 1,
      date: new Date(),
      market: createMockMarket("eth-updown-5m", 5),
      size: 8.84,
      price: 0.57,
      op: "sell" as const,
      direction: "up" as const,
    }),
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m", 5)],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const tinyExitOrder: QmonPendingOrder = {
    ...createPendingOrder("eth-5m", "exit", "SELL_UP"),
    requestedShares: 8.84,
    remainingShares: 8.84,
  };
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      tinyExitOrder,
      "BUY_UP",
      createRealExecutionRuntime({
        executionState: "real-open",
        confirmedVenueSeat: {
          action: "BUY_UP",
          shareCount: 8.8432,
          entryPrice: 0.38,
          enteredAt: 100,
        },
      }),
    ),
  ]);
  const applyFill = engine.applyRealSeatPendingOrderFill;

  engine.applyRealSeatPendingOrderFill = (market: "eth-5m" | "btc-5m", averagePrice: number) => {
    applyFill.call(engine, market, averagePrice);
    const population = engine.getPopulation(market);

    if (population !== null) {
      engine.setRealExecutionRuntime(market, {
        ...(population.executionRuntime ?? createRealExecutionRuntime()),
        route: "real",
        executionState: "real-open",
        confirmedVenueSeat: {
          action: "BUY_UP",
          shareCount: 0.0032,
          entryPrice: 0.38,
          enteredAt: 100,
        },
      });
    }
  };

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(engine.getPopulation("eth-5m")?.seatPosition.action, null);
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder, null);
  assert.equal(status.marketRoutes[0]?.confirmedLiveSeat, null);
  assert.equal(status.marketRoutes[0]?.isHalted, false);
});

test("QmonLiveExecutionService keeps post failures without order ids scoped to the current window", async () => {
  let postCount = 0;
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => {
      postCount += 1;
      throw new Error("venue rejected order");
    },
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m", 1)],
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

  assert.equal(postCount, 1);
  assert.equal(status.marketRoutes[0]?.isHalted, false);
  assert.equal(status.marketRoutes[0]?.executionState, "real-error");
  assert.equal(status.marketRoutes[0]?.pendingIntent, null);
  assert.match(status.marketRoutes[0]?.lastError ?? "", /venue rejected order/);
  assert.equal(engine.getPopulation("eth-5m")?.seatPendingOrder, null);
});

test("QmonLiveExecutionService clears window-scoped live blocks on the next market window", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => null,
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m", 1)],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([
    {
      ...createPopulation(
        "eth-5m",
        null,
        null,
        createRealExecutionRuntime({
          executionState: "real-error",
          submittedAt: 150,
          lastError: "venue rejected order",
          isHalted: false,
        }),
      ),
      seatLastWindowStartMs: 300,
    },
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals(300, 400) as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(status.marketRoutes[0]?.isHalted, false);
  assert.equal(status.marketRoutes[0]?.executionState, "real-armed");
  assert.equal(status.marketRoutes[0]?.lastError, null);
  assert.equal(status.marketRoutes[0]?.submittedAt, null);
});

test("QmonLiveExecutionService clears hard halts when the next window starts and no live risk remains", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
    postOrder: async () => null,
    waitForOrderConfirmation: async () => null,
  };
  const marketCatalogService = {
    loadCryptoWindowMarkets: async () => [createMockMarket("eth-updown-5m", 1)],
  };
  const liveExecutionService = new QmonLiveExecutionService(
    orderService as never,
    marketCatalogService as never,
    createMockLiveStatePersistence() as never,
    null,
  );
  const engine = createMockEngine([
    {
      ...createPopulation(
        "eth-5m",
        null,
        null,
        createRealExecutionRuntime({
          executionState: "real-halted",
          submittedAt: 150,
          lastError: "window halt",
          isHalted: true,
        }),
      ),
      seatLastWindowStartMs: 300,
    },
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals(300, 400) as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(status.marketRoutes[0]?.isHalted, false);
  assert.equal(status.marketRoutes[0]?.executionState, "real-armed");
  assert.equal(status.marketRoutes[0]?.lastError, null);
  assert.equal(status.marketRoutes[0]?.submittedAt, null);
});

test("QmonLiveExecutionService clears stale confirmed venue seats when the local seat is already flat", async () => {
  const orderService = {
    init: async () => undefined,
    getMyBalance: async () => 10,
    listActiveOrdersPendingConfirmation: async () => [],
    cancelOrderById: async () => true,
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
  const engine = createMockEngine([
    createPopulation(
      "eth-5m",
      null,
      null,
      createRealExecutionRuntime({
        executionState: "real-open",
        confirmedVenueSeat: {
          action: "BUY_UP",
          shareCount: 5,
          entryPrice: 0.38,
          enteredAt: 100,
        },
      }),
    ),
  ]);

  await liveExecutionService.initialize({
    mode: "real",
    privateKey: "0xabc",
    confirmationTimeoutMs: 5_000,
    persistedState: null,
    cpnlSessionStartedAt: null,
  });

  liveExecutionService.queueSync(engine as never, createSignals() as never);
  await liveExecutionService.flush();
  const status = liveExecutionService.getStatus(engine.getPopulations());

  assert.equal(status.marketRoutes[0]?.executionState, "real-armed");
  assert.equal(status.marketRoutes[0]?.isHalted, false);
  assert.equal(status.marketRoutes[0]?.confirmedLiveSeat, null);
});
