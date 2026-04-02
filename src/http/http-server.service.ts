/**
 * @section imports:externals
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { QmonDashboardPayload, RuntimeExecutionStatus } from "../app/app-runtime.types.ts";
import type { DiagnosticCategory, DiagnosticRange, QmonEngine, QmonValidationLogService } from "../qmon/index.ts";
import { RegimeEngine } from "../regime/regime-engine.service.ts";
import type { RegimeEvent, RegimeResult } from "../regime/regime.types.ts";
import { SignalEngine } from "../signal/signal-engine.service.ts";
import type { StructuredSignalResult } from "../signal/signal.types.ts";
import { TriggerEngine } from "../trigger/trigger-engine.service.ts";
import type { TriggerEvent } from "../trigger/trigger.types.ts";

/**
 * @section consts
 */

/**
 * Resolve the public directory path relative to this file's location.
 * Works both in source (src/http/) and compiled (dist/http/) contexts.
 */
const PUBLIC_DIR = join(import.meta.dirname ?? ".", "..", "..", "public");

/**
 * @section class
 */

export class HttpServerService {
  /**
   * @section private:attributes
   */

  private readonly signalEngine: SignalEngine;
  private readonly triggerEngine: TriggerEngine;
  private readonly regimeEngine: RegimeEngine;
  private readonly qmonEngine: QmonEngine | null;
  private readonly qmonValidationLogService: QmonValidationLogService | null;
  private readonly runtimeExecutionStatusProvider: (() => RuntimeExecutionStatus) | null;
  private lastStructuredResult: StructuredSignalResult | null;
  private lastTriggers: readonly TriggerEvent[];
  private lastRegimes: RegimeResult;
  private lastRegimeEvents: readonly RegimeEvent[];
  private cachedQmonFamilyVersion: number | null;
  private cachedQmonFamilyJson: string | null;
  private cachedQmonSummaryVersion: number | null;
  private cachedQmonSummaryJson: string | null;
  private apiQmonsCacheHits: number;
  private apiQmonsCacheMisses: number;
  private apiQmonsSerializationTotalMs: number;
  private apiQmonsSerializationCount: number;

  /**
   * @section constructor
   */

  public constructor(
    signalEngine: SignalEngine,
    triggerEngine: TriggerEngine,
    regimeEngine: RegimeEngine,
    qmonEngine: QmonEngine | null = null,
    qmonValidationLogService: QmonValidationLogService | null = null,
    runtimeExecutionStatusProvider: (() => RuntimeExecutionStatus) | null = null,
  ) {
    this.signalEngine = signalEngine;
    this.triggerEngine = triggerEngine;
    this.regimeEngine = regimeEngine;
    this.qmonEngine = qmonEngine;
    this.qmonValidationLogService = qmonValidationLogService;
    this.runtimeExecutionStatusProvider = runtimeExecutionStatusProvider;
    this.lastStructuredResult = null;
    this.lastTriggers = [];
    this.lastRegimes = {};
    this.lastRegimeEvents = [];
    this.cachedQmonFamilyVersion = null;
    this.cachedQmonFamilyJson = null;
    this.cachedQmonSummaryVersion = null;
    this.cachedQmonSummaryJson = null;
    this.apiQmonsCacheHits = 0;
    this.apiQmonsCacheMisses = 0;
    this.apiQmonsSerializationTotalMs = 0;
    this.apiQmonsSerializationCount = 0;
  }

  /**
   * @section factory
   */

  public static createDefault(
    qmonEngine: QmonEngine | null = null,
    signalEngine?: SignalEngine,
    qmonValidationLogService: QmonValidationLogService | null = null,
    runtimeExecutionStatusProvider: (() => RuntimeExecutionStatus) | null = null,
  ): HttpServerService {
    return new HttpServerService(
      signalEngine ?? SignalEngine.createDefault(),
      TriggerEngine.createDefault(),
      RegimeEngine.createDefault(),
      qmonEngine,
      qmonValidationLogService,
      runtimeExecutionStatusProvider,
    );
  }

  /**
   * @section private:methods
   */

  /**
   * Read the canonical QMON dashboard HTML file from the public directory.
   */
  private readIndexHtml(): string | null {
    let result: string | null = null;

    try {
      result = readFileSync(join(PUBLIC_DIR, "index.html"), "utf-8");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Index HTML not found at ${PUBLIC_DIR}: ${message}`);
      result = null;
    }

    return result;
  }

  /**
   * Read the signals dashboard HTML file from the public directory.
   */
  private readSignalsHtml(): string | null {
    let result: string | null = null;

    try {
      result = readFileSync(join(PUBLIC_DIR, "signals.html"), "utf-8");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Signals HTML not found at ${PUBLIC_DIR}: ${message}`);
      result = null;
    }

    return result;
  }

  /**
   * Normalize diagnostics range queries into one of the supported fixed buckets.
   */
  private parseDiagnosticsRange(requestedRange: string | null): DiagnosticRange {
    let diagnosticsRange: DiagnosticRange = "24h";

    if (requestedRange === "7d" || requestedRange === "30d") {
      diagnosticsRange = requestedRange;
    }

    return diagnosticsRange;
  }

  /**
   * Normalize diagnostics category queries and ignore unsupported values.
   */
  private parseDiagnosticsCategory(requestedCategory: string | null): DiagnosticCategory | undefined {
    let diagnosticsCategory: DiagnosticCategory | undefined;

    if (
      requestedCategory === "execution" ||
      requestedCategory === "position" ||
      requestedCategory === "window" ||
      requestedCategory === "warning" ||
      requestedCategory === "lifecycle"
    ) {
      diagnosticsCategory = requestedCategory;
    }

    return diagnosticsCategory;
  }

  /**
   * Return a cached serialized family state whenever the engine mutation version did not change.
   */
  private getCachedFamilyStateJson(): string {
    const familyState = this.qmonEngine?.getFamilyState();
    const familyVersion = this.qmonEngine?.getStateSnapshotVersion() ?? null;
    let familyStateJson = this.cachedQmonFamilyJson ?? '{"populations":[],"globalGeneration":0,"createdAt":0,"lastUpdated":0}';

    if (
      familyState !== undefined &&
      familyState !== null &&
      familyVersion !== null &&
      this.cachedQmonFamilyVersion === familyVersion &&
      this.cachedQmonFamilyJson !== null
    ) {
      this.apiQmonsCacheHits += 1;
    } else if (familyState !== undefined && familyState !== null) {
      const serializationStartedAt = Date.now();

      familyStateJson = JSON.stringify(familyState);
      this.cachedQmonFamilyVersion = familyVersion;
      this.cachedQmonFamilyJson = familyStateJson;
      this.apiQmonsCacheMisses += 1;
      this.apiQmonsSerializationCount += 1;
      this.apiQmonsSerializationTotalMs += Date.now() - serializationStartedAt;
    }

    return familyStateJson;
  }

  /**
   * Build the compact QMON payload used by the dashboard grid.
   */
  private buildQmonSummary(qmon: Record<string, unknown>): Record<string, unknown> {
    const qmonMetrics = (qmon.metrics as Record<string, unknown> | undefined) ?? {};
    const qmonSummary = {
      id: qmon.id,
      market: qmon.market,
      role: qmon.role,
      lifecycle: qmon.lifecycle,
      generation: qmon.generation,
      createdAt: qmon.createdAt,
      position: qmon.position,
      metrics: {
        totalPnl: qmonMetrics.totalPnl ?? 0,
        fitnessScore: qmonMetrics.fitnessScore ?? null,
        totalEstimatedNetEvUsd: qmonMetrics.totalEstimatedNetEvUsd ?? 0,
        feeRatio: qmonMetrics.feeRatio ?? null,
        isChampionEligible: qmonMetrics.isChampionEligible ?? false,
      },
      paperWindowBaselinePnl: qmon.paperWindowBaselinePnl,
      windowsLived: qmon.windowsLived,
    };

    return qmonSummary;
  }

  /**
   * Build the compact population payload used by the dashboard grid.
   */
  private buildPopulationSummary(population: Record<string, unknown>): Record<string, unknown> {
    const qmons = Array.isArray(population.qmons) ? population.qmons : [];
    const populationSummary = {
      market: population.market,
      createdAt: population.createdAt,
      lastUpdated: population.lastUpdated,
      activeChampionQmonId: population.activeChampionQmonId,
      marketPaperSessionPnl: population.marketPaperSessionPnl,
      marketConsolidatedPnl: population.marketConsolidatedPnl,
      seatPosition: population.seatPosition,
      seatPendingOrder: population.seatPendingOrder,
      seatLastCloseTimestamp: population.seatLastCloseTimestamp,
      seatLastWindowStartMs: population.seatLastWindowStartMs,
      seatLastSettledWindowStartMs: population.seatLastSettledWindowStartMs,
      executionRuntime: population.executionRuntime ?? null,
      qmons: qmons.map((qmon) => this.buildQmonSummary(qmon as Record<string, unknown>)),
    };

    return populationSummary;
  }

  /**
   * Return a cached serialized family summary whenever the engine mutation version did not change.
   */
  private getCachedFamilySummaryJson(): string {
    const familyState = this.qmonEngine?.getFamilyState();
    const familyVersion = this.qmonEngine?.getStateSnapshotVersion() ?? null;
    let familySummaryJson = this.cachedQmonSummaryJson ?? '{"populations":[],"globalGeneration":0,"createdAt":0,"lastUpdated":0}';

    if (
      familyState !== undefined &&
      familyState !== null &&
      familyVersion !== null &&
      this.cachedQmonSummaryVersion === familyVersion &&
      this.cachedQmonSummaryJson !== null
    ) {
      this.apiQmonsCacheHits += 1;
    } else if (familyState !== undefined && familyState !== null) {
      const serializationStartedAt = Date.now();
      const familySummary = {
        populations: familyState.populations.map((population) => this.buildPopulationSummary(population as unknown as Record<string, unknown>)),
        globalGeneration: familyState.globalGeneration,
        createdAt: familyState.createdAt,
        lastUpdated: familyState.lastUpdated,
      };

      familySummaryJson = JSON.stringify(familySummary);
      this.cachedQmonSummaryVersion = familyVersion;
      this.cachedQmonSummaryJson = familySummaryJson;
      this.apiQmonsCacheMisses += 1;
      this.apiQmonsSerializationCount += 1;
      this.apiQmonsSerializationTotalMs += Date.now() - serializationStartedAt;
    }

    return familySummaryJson;
  }

  /**
   * Measure how long the server spends rebuilding the `/api/qmons` response.
   */
  private getAverageApiQmonsSerializationMs(): number {
    let averageApiQmonsSerializationMs = 0;

    if (this.apiQmonsSerializationCount > 0) {
      averageApiQmonsSerializationMs = this.apiQmonsSerializationTotalMs / this.apiQmonsSerializationCount;
    }

    return averageApiQmonsSerializationMs;
  }

  /**
   * Build the operator-facing dashboard payload from canonical runtime state.
   */
  private buildDashboardPayload(diagnosticsOverview: unknown): QmonDashboardPayload {
    const familyState = this.qmonEngine?.getFamilyState() ?? {
      populations: [],
      globalGeneration: 0,
      createdAt: 0,
      lastUpdated: 0,
    };
    const familySummary = {
      populations: familyState.populations.map((population) => this.buildPopulationSummary(population as unknown as Record<string, unknown>)),
      globalGeneration: familyState.globalGeneration,
      createdAt: familyState.createdAt,
      lastUpdated: familyState.lastUpdated,
    };
    const runtimeExecutionStatus = this.runtimeExecutionStatusProvider?.() ?? {
      mode: "paper",
      balanceUsd: null,
      balanceState: "unavailable",
      balanceUpdatedAt: null,
      cpnlSessionStartedAt: null,
      marketRoutes: [],
    };
    const dashboardPayload: QmonDashboardPayload = {
      generatedAt: Date.now(),
      familyState: familySummary,
      runtimeExecutionStatus,
      diagnosticsOverview,
    };

    return dashboardPayload;
  }

  /**
   * @section public:methods
   */

  /**
   * Update the cached signal result. Called externally each time the
   * snapshot buffer is refreshed so the API endpoint serves fresh data.
   */
  public updateSignals(snapshots: readonly Record<string, unknown>[]): void {
    const typed = snapshots as readonly { generated_at: number }[];
    this.lastStructuredResult = this.signalEngine.calculateStructured(typed);
    this.lastTriggers = this.triggerEngine.evaluate(this.lastStructuredResult);
    const regimeResult = this.regimeEngine.evaluate(this.lastStructuredResult);
    this.lastRegimes = regimeResult.states;
    this.lastRegimeEvents = regimeResult.events;
  }

  /**
   * Get the last evaluated triggers for QMON processing.
   */
  public getLastTriggers(): readonly TriggerEvent[] {
    return this.lastTriggers;
  }

  /**
   * Get the last evaluated regimes for QMON processing.
   */
  public getLastRegimes(): RegimeResult {
    return this.lastRegimes;
  }

  /**
   * Get the last structured signals for QMON processing.
   */
  public getLastStructuredSignals(): StructuredSignalResult | null {
    return this.lastStructuredResult;
  }

  public buildServer(): ServerType {
    const app = new Hono();

    // Main page is now QMON dashboard
    app.get("/", (context) => {
      const qmonHtml = this.readIndexHtml();
      if (qmonHtml === null) {
        return context.text("QMON dashboard not found", 404);
      }
      return context.html(qmonHtml);
    });

    app.get("/api/signals/structured", (context) => {
      const basePayload = this.lastStructuredResult ?? {};
      const payload = { ...basePayload, triggers: this.lastTriggers, regimes: this.lastRegimes, regimeEvents: this.lastRegimeEvents };
      return context.json(payload, 200);
    });

    // QMON API endpoints
    app.get("/api/qmons", (context) => {
      if (!this.qmonEngine) {
        return context.json({ error: "QMON engine not initialized" }, 503);
      }
      const familyStateJson = this.getCachedFamilyStateJson();
      return context.body(familyStateJson, 200, { "Content-Type": "application/json" });
    });

    app.get("/api/qmons/summary", (context) => {
      if (!this.qmonEngine) {
        return context.json({ error: "QMON engine not initialized" }, 503);
      }
      const familySummaryJson = this.getCachedFamilySummaryJson();
      return context.body(familySummaryJson, 200, { "Content-Type": "application/json" });
    });

    app.get("/api/qmons/dashboard", async (context) => {
      if (!this.qmonEngine) {
        return context.json({ error: "QMON engine not initialized" }, 503);
      }

      const diagnosticsOverview =
        this.qmonValidationLogService !== null ? await this.qmonValidationLogService.readDiagnosticsOverview("24h") : null;

      return context.json(this.buildDashboardPayload(diagnosticsOverview), 200);
    });

    app.get("/api/qmons/stats", (context) => {
      if (!this.qmonEngine) {
        return context.json({ error: "QMON engine not initialized" }, 503);
      }
      const stats = {
        ...this.qmonEngine.getStats(),
        apiQmonsCacheHits: this.apiQmonsCacheHits,
        apiQmonsCacheMisses: this.apiQmonsCacheMisses,
        averageApiQmonsSerializationMs: this.getAverageApiQmonsSerializationMs(),
      };
      return context.json(stats, 200);
    });

    app.get("/api/runtime-status", (context) => {
      const runtimeExecutionStatus = this.runtimeExecutionStatusProvider?.() ?? {
        mode: "paper",
        balanceUsd: null,
        balanceState: "unavailable",
        balanceUpdatedAt: null,
        cpnlSessionStartedAt: null,
        marketRoutes: [],
      };

      return context.json(runtimeExecutionStatus, 200);
    });

    app.get("/api/qmons/activity", async (context) => {
      if (this.qmonValidationLogService === null) {
        return context.json([], 200);
      }

      const requestedLimit = Number(context.req.query("limit") ?? "50");
      const safeLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 50;
      const activityEvents = await this.qmonValidationLogService.readRecentEvents(safeLimit);
      return context.json(activityEvents, 200);
    });

    app.get("/api/qmons/cpnl-log", async (context) => {
      if (this.qmonValidationLogService === null) {
        return context.json([], 200);
      }

      const diagnosticsRange = this.parseDiagnosticsRange(context.req.query("range") ?? null);
      const requestedLimit = Number(context.req.query("limit") ?? "100");
      const safeLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000) : 100;
      const cpnlEvents = await this.qmonValidationLogService.readCpnlLogRows(diagnosticsRange, safeLimit);

      return context.json(cpnlEvents, 200);
    });

    app.get("/api/qmons/diagnostics/overview", async (context) => {
      if (this.qmonValidationLogService === null) {
        return context.json(
          {
            range: this.parseDiagnosticsRange(context.req.query("range") ?? null),
            generatedAt: Date.now(),
            totals: {
              totalEvents: 0,
              warningCount: 0,
              seatRealizedPnl: 0,
              totalRealizedPnl: 0,
              fillRate: 0,
              orderFailureRate: 0,
              avgPriceImpactBps: null,
              seatTradeCount: 0,
            },
            flags: [],
            markets: [],
          },
          200,
        );
      }

      const diagnosticsRange = this.parseDiagnosticsRange(context.req.query("range") ?? null);
      const diagnosticsOverview = await this.qmonValidationLogService.readDiagnosticsOverview(diagnosticsRange);

      return context.json(diagnosticsOverview, 200);
    });

    app.get("/api/qmons/diagnostics/market", async (context) => {
      if (this.qmonValidationLogService === null) {
        return context.json({ error: "QMON diagnostics not initialized" }, 503);
      }

      const market = context.req.query("market");

      if (!market) {
        return context.json({ error: "market query parameter is required" }, 400);
      }

      const diagnosticsRange = this.parseDiagnosticsRange(context.req.query("range") ?? null);
      const marketDiagnostics = await this.qmonValidationLogService.readMarketDiagnostics(market, diagnosticsRange);

      return context.json(marketDiagnostics, 200);
    });

    app.get("/api/qmons/diagnostics/events", async (context) => {
      if (this.qmonValidationLogService === null) {
        return context.json([], 200);
      }

      const market = context.req.query("market") ?? undefined;
      const category = this.parseDiagnosticsCategory(context.req.query("category") ?? null);
      const diagnosticsRange = this.parseDiagnosticsRange(context.req.query("range") ?? null);
      const requestedLimit = Number(context.req.query("limit") ?? "100");
      const safeLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500) : 100;
      const diagnosticEvents = await this.qmonValidationLogService.readDiagnosticEvents(market, category, diagnosticsRange, safeLimit);

      return context.json(diagnosticEvents, 200);
    });

    app.get("/api/qmons/market-activity", async (context) => {
      if (this.qmonValidationLogService === null) {
        return context.json([], 200);
      }

      const market = context.req.query("market");

      if (!market) {
        return context.json({ error: "market query parameter is required" }, 400);
      }

      const diagnosticsRange = this.parseDiagnosticsRange(context.req.query("range") ?? null);
      const requestedLimit = Number(context.req.query("limit") ?? "500");
      const safeLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 5000) : 500;
      const marketActivityEvents = await this.qmonValidationLogService.readMarketSeatEvents(market, diagnosticsRange, safeLimit);
      return context.json(marketActivityEvents, 200);
    });

    app.get("/api/qmons/:id", (context) => {
      if (!this.qmonEngine) {
        return context.json({ error: "QMON engine not initialized" }, 503);
      }
      const id = context.req.param("id");
      const qmon = this.qmonEngine.getQmon(id);
      if (!qmon) {
        return context.json({ error: "QMON not found" }, 404);
      }
      return context.json(qmon, 200);
    });

    app.get("/signals.html", (context) => {
      const signalsHtml = this.readSignalsHtml();
      if (signalsHtml === null) {
        return context.text("Signals dashboard not found", 404);
      }
      return context.html(signalsHtml);
    });

    app.get("/qmons.html", (context) => {
      return context.redirect("/", 301);
    });

    app.get("/dashboard", (context) => {
      return context.redirect("/", 301);
    });

    return createAdaptorServer({ fetch: app.fetch });
  }
}
