import * as assert from "node:assert/strict";
import { test } from "node:test";

import { QmonLiveExecutionService } from "../src/qmon/qmon-live-execution.service.ts";

test("QmonLiveExecutionService upgrades mirrored size to the venue minimum", () => {
  const qmonLiveExecutionService = QmonLiveExecutionService.createDefault(5);
  const mirroredShareCount = qmonLiveExecutionService.resolveMirroredShareCount(5, 12);

  assert.equal(mirroredShareCount, 12);
});
