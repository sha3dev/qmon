import * as assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ServiceRuntime } from "../src/app/service-runtime.service.ts";

async function withServer<T>(callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(join(tmpdir(), "qmon-runtime-"));
  const serviceRuntime = await ServiceRuntime.createDefault({ dataDir });
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

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  }
}

test("ServiceRuntime serves the reduced qmon payload", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qmons`);
    const json = await response.json();
    const firstPopulation = json.populations?.[0];
    const firstQmon = firstPopulation?.qmons?.[0];

    assert.equal(response.status, 200);
    assert.equal(json.mode === "paper" || json.mode === "real", true);
    assert.equal(Array.isArray(json.populations), true);
    assert.ok(firstPopulation);
    assert.ok(firstQmon);
    assert.equal(firstPopulation.qmons.length, 2);
    assert.equal(typeof firstQmon.metrics.recentWindowPnlSum, "number");
    assert.ok("realSeat" in firstPopulation);
  });
});

test("ServiceRuntime serves qmon stats for the preset-only runtime", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qmons/stats`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.totalPopulations, 8);
    assert.equal(json.totalQmons, 16);
    assert.equal(typeof json.activeChampionCount, "number");
    assert.equal(typeof json.totalPnl, "number");
  });
});

test("ServiceRuntime serves structured signals before snapshots arrive", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/signals/structured`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.structuredSignals, null);
    assert.deepEqual(json.regimes, {});
    assert.deepEqual(json.regimeEvents, []);
  });
});
