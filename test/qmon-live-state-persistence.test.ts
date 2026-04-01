import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { QmonLiveStatePersistenceService } from "../src/qmon/qmon-live-state-persistence.service.ts";

test("QmonLiveStatePersistenceService clears persisted live execution state", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "qmon-live-state-"));
  const liveStatePersistenceService = new QmonLiveStatePersistenceService(tempDir);

  try {
    await liveStatePersistenceService.save({
      updatedAt: Date.now(),
      markets: [
        {
          market: "eth-5m",
          routeState: "halted",
          pendingIntentKey: "intent",
          submittedAt: 1,
          orderId: "1",
          confirmedLiveSeat: {
            action: "BUY_UP",
            shareCount: 5,
            entryPrice: 0.4,
            enteredAt: 1,
          },
          lastError: "halted",
        },
      ],
    });

    const wasCleared = await liveStatePersistenceService.clear();
    const loadedState = await liveStatePersistenceService.load();

    assert.equal(wasCleared, true);
    assert.equal(loadedState, null);
  } finally {
    await rm(tempDir, {
      recursive: true,
      force: true,
    });
  }
});
