import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { QmonValidationLogService } from "../src/qmon/qmon-validation-log.service.ts";

function withMockNow<T>(mockNow: number, run: () => T): T {
  const originalDateNow = Date.now;

  Date.now = () => mockNow;

  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

test("QmonValidationLogService reports order failure rate and taker CPnL rows", async () => {
  const diagnosticsDir = await mkdtemp(join(tmpdir(), "qmon-diagnostics-"));
  const validationLogService = new QmonValidationLogService(diagnosticsDir);
  const mockNow = Date.now();

  try {
    withMockNow(mockNow, () => {
      validationLogService.logPaperOrderCreated({
        market: "btc-5m",
        qmonId: "QMON01",
        action: "BUY_UP",
      });
      validationLogService.logPaperOrderFilled({
        market: "btc-5m",
        qmonId: "QMON01",
        action: "BUY_UP",
        priceImpactBps: 12,
      });
      validationLogService.logPaperOrderCreated({
        market: "btc-5m",
        qmonId: "QMON01",
        action: "SELL_UP",
      });
      validationLogService.logPaperOrderExpired({
        market: "btc-5m",
        qmonId: "QMON01",
        action: "SELL_UP",
        reason: "market-ended",
      });
      validationLogService.logPositionClosed({
        market: "btc-5m",
        qmonId: "QMON01",
        action: "BUY_UP",
        reason: "sell-threshold-hit",
        entryPrice: 0.1,
        exitPrice: 0.7,
        executionPrice: 0.7,
        shareCount: 5,
        grossPnl: 3,
        fee: 0.1,
        netPnl: 2.9,
        cashflow: 3.4,
        holdDurationMs: 1_000,
        isSeat: true,
      });
    });

    await validationLogService.flush();

    const overview = await validationLogService.readDiagnosticsOverview("24h");
    const marketSummary = await validationLogService.readMarketDiagnostics("btc-5m", "24h");
    const cpnlLogRows = await validationLogService.readCpnlLogRows("24h", 10);

    assert.equal(overview.totals.orderFailureRate, 0.5);
    assert.equal(marketSummary.orderFailureRate, 0.5);
    assert.equal(marketSummary.fillRate, 0.5);
    assert.equal(marketSummary.seatRealizedPnl, 2.9);
    assert.equal(cpnlLogRows.length, 1);
    assert.equal(cpnlLogRows[0]?.detail.includes("TAKER"), true);
    assert.equal(cpnlLogRows[0]?.cashflow, 3.4);
  } finally {
    await rm(diagnosticsDir, { recursive: true, force: true });
  }
});

test("QmonValidationLogService ignores tradeability warnings in diagnostics aggregates", async () => {
  const diagnosticsDir = await mkdtemp(join(tmpdir(), "qmon-diagnostics-"));
  const validationLogService = new QmonValidationLogService(diagnosticsDir);
  const mockNow = Date.now();

  try {
    withMockNow(mockNow, () => {
      validationLogService.logValidationWarning({
        market: "btc-5m",
        qmonId: "QMON01",
        warningCode: "tradeability-alpha-below-threshold",
        details: "alpha=0.1000",
      });
      validationLogService.logValidationWarning({
        market: "btc-5m",
        qmonId: "QMON01",
        warningCode: "slippage-rejected",
        details: "priceImpactBps=32.00",
      });
    });

    await validationLogService.flush();

    const overview = await validationLogService.readDiagnosticsOverview("24h");
    const marketSummary = await validationLogService.readMarketDiagnostics("btc-5m", "24h");

    assert.equal(overview.totals.warningCount, 1);
    assert.equal(marketSummary.warningCount, 1);
    assert.equal(marketSummary.slippageRejectedCount, 1);
  } finally {
    await rm(diagnosticsDir, { recursive: true, force: true });
  }
});

test("QmonValidationLogService resets persisted CPnL diagnostics state", async () => {
  const diagnosticsDir = await mkdtemp(join(tmpdir(), "qmon-diagnostics-"));
  const validationLogService = new QmonValidationLogService(diagnosticsDir);
  const mockNow = Date.now();

  try {
    withMockNow(mockNow, () => {
      validationLogService.logPositionClosed({
        market: "eth-5m",
        qmonId: "QMON02",
        action: "BUY_UP",
        reason: "market-settled",
        entryPrice: 0.2,
        exitPrice: 0.8,
        executionPrice: 0.8,
        shareCount: 5,
        grossPnl: 3,
        fee: 0.1,
        netPnl: 2.9,
        cashflow: 3.9,
        holdDurationMs: 1_000,
        isSeat: true,
      });
    });

    await validationLogService.flush();
    await validationLogService.resetCpnlState();

    const overview = await validationLogService.readDiagnosticsOverview("24h");
    const cpnlLogRows = await validationLogService.readCpnlLogRows("24h", 10);

    assert.equal(overview.totals.seatRealizedPnl, 0);
    assert.equal(overview.totals.seatTradeCount, 0);
    assert.equal(cpnlLogRows.length, 0);
  } finally {
    await rm(diagnosticsDir, { recursive: true, force: true });
  }
});

test("QmonValidationLogService clears persisted diagnostics state", async () => {
  const diagnosticsDir = await mkdtemp(join(tmpdir(), "qmon-diagnostics-"));
  const validationLogService = new QmonValidationLogService(diagnosticsDir);

  try {
    validationLogService.logValidationWarning({
      market: "eth-5m",
      qmonId: "QMON03",
      warningCode: "live-order-failed",
      details: "failed",
    });

    await validationLogService.flush();
    await validationLogService.clearPersistedState();

    const overview = await validationLogService.readDiagnosticsOverview("24h");
    const recentEvents = await validationLogService.readRecentEvents(10);

    assert.equal(overview.totals.totalEvents, 0);
    assert.equal(recentEvents.length, 0);
  } finally {
    await rm(diagnosticsDir, { recursive: true, force: true });
  }
});
