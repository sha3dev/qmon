import * as assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { QmonEngine } from "../src/qmon/qmon-engine.service.ts";
import { QmonPersistenceService } from "../src/qmon/qmon-persistence.service.ts";

test("QmonPersistenceService saves and reloads the v1 family state", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "qmon-persistence-"));
  const qmonPersistenceService = QmonPersistenceService.createDefault(dataDir);
  const qmonEngine = QmonEngine.createDefault(["btc"], ["5m"]);

  const wasSaved = await qmonPersistenceService.save(qmonEngine.getFamilyState());
  const loadedFamilyState = await qmonPersistenceService.load();

  assert.equal(wasSaved, true);
  assert.ok(loadedFamilyState);
  assert.equal(loadedFamilyState.schemaVersion, 1);
  assert.equal(loadedFamilyState.populations[0]?.market, "btc-5m");
});

test("QmonPersistenceService ignores legacy or invalid payloads", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "qmon-persistence-legacy-"));
  const statePath = join(dataDir, "qmon-v1-state.json");
  const qmonPersistenceService = QmonPersistenceService.createDefault(dataDir);

  await writeFile(statePath, JSON.stringify({ populations: [], globalGeneration: 4 }), "utf-8");

  const loadedFamilyState = await qmonPersistenceService.load();

  assert.equal(loadedFamilyState, null);
});
