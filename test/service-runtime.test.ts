import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceRuntime } from "../src/index.ts";

test("ServiceRuntime serves the QMON stats API", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  // Test the QMON stats endpoint
  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons/stats`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.ok("totalPopulations" in json);
  assert.ok("totalQmons" in json);
  assert.ok("totalDecisions" in json);
  assert.ok("globalGeneration" in json);

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

test("ServiceRuntime serves the structured signals payload before snapshots arrive", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

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
  assert.deepEqual(json, { triggers: [], regimes: {}, regimeEvents: [] });

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

test("ServiceRuntime serves recent QMON activity events", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons/activity?limit=5`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(json));

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

test("ServiceRuntime serves the market CPnL log feed", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons/cpnl-log?range=24h&limit=5`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(json));
  assert.equal(
    json.some((item: { message?: string }) => item.message === "champion-changed"),
    false,
  );

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

test("ServiceRuntime serves diagnostics overview payloads", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons/diagnostics/overview?range=24h`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.ok("range" in json);
  assert.ok("totals" in json);
  assert.ok(Array.isArray(json.markets));
  assert.ok(Array.isArray(json.flags));

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

test("ServiceRuntime serves market diagnostics payloads", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons/diagnostics/market?market=btc-5m&range=24h`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.market, "btc-5m");
  assert.ok("fillRate" in json);
  assert.ok(Array.isArray(json.flags));

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

test("ServiceRuntime serves champion readiness metrics on the QMON payload", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons`);
  const json = await response.json();
  const firstPopulation = json.populations?.[0];
  const firstQmon = json.populations?.[0]?.qmons?.[0];

  assert.equal(response.status, 200);
  assert.ok(firstPopulation);
  assert.ok("realWalkForwardGate" in firstPopulation);
  assert.ok(firstQmon);
  assert.ok("strategyKind" in firstQmon);
  assert.ok("strategyName" in firstQmon);
  assert.ok("strategyDescription" in firstQmon);
  assert.ok("presetStrategyId" in firstQmon);
  assert.ok("presetFamily" in firstQmon);
  assert.ok("beliefWeights" in firstQmon.genome);
  assert.ok("riskBudgetUsd" in firstQmon.genome);
  assert.ok("paperWindowMedianPnl" in firstQmon.metrics);
  assert.ok("paperWindowPnlSum" in firstQmon.metrics);
  assert.ok("paperLongWindowPnlSum" in firstQmon.metrics);
  assert.ok("negativeWindowRateLast10" in firstQmon.metrics);
  assert.ok("worstWindowPnlLast10" in firstQmon.metrics);
  assert.ok("championScore" in firstQmon.metrics);
  assert.ok("recentAvgSlippageBps" in firstQmon.metrics);
  assert.ok("marketExposureRatio" in firstQmon.metrics);
  assert.ok("positionHoldTicks" in firstQmon.metrics);
  assert.ok("tradesPerWindow" in firstQmon.metrics);
  assert.ok("totalFeesPaid" in firstQmon.metrics);
  assert.ok("isChampionEligible" in firstQmon.metrics);
  assert.ok("championEligibilityReasons" in firstQmon.metrics);

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

test("ServiceRuntime serves market seat activity events", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/qmons/market-activity?market=btc-5m&range=24h&limit=5`);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(json));

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

test("ServiceRuntime redirects legacy QMON dashboard routes to the canonical root dashboard", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const qmonDashboardResponse = await fetch(`http://127.0.0.1:${address.port}/qmons.html`, { redirect: "manual" });
  const legacyDashboardResponse = await fetch(`http://127.0.0.1:${address.port}/dashboard`, { redirect: "manual" });

  assert.equal(qmonDashboardResponse.status, 301);
  assert.equal(qmonDashboardResponse.headers.get("location"), "/");
  assert.equal(legacyDashboardResponse.status, 301);
  assert.equal(legacyDashboardResponse.headers.get("location"), "/");

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

test("ServiceRuntime serves the operator-first dashboard labels", async () => {
  const serviceRuntime = await ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(html.includes("LIVE ACTIVITY"), false);
  assert.equal(html.includes("SYSTEM ALERTS"), false);
  assert.equal(html.includes("CPNL LOG"), true);
  assert.equal(html.includes("STRATEGY"), true);
  assert.equal(html.includes("P / R"), true);
  assert.equal(html.includes("Markets Without Champion"), false);

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
