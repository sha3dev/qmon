/**
 * @section imports:externals
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";

/**
 * @section imports:internals
 */

import type { RuntimeExecutionStatus } from "../app/app-runtime.types.ts";
import type { QmonEngine } from "../qmon/index.ts";
import { RegimeEngine } from "../regime/regime-engine.service.ts";
import type { RegimeEvent, RegimeResult } from "../regime/regime.types.ts";
import { SignalEngine } from "../signal/signal-engine.service.ts";
import type { Snapshot, StructuredSignalResult } from "../signal/signal.types.ts";

/**
 * @section consts
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
  private readonly regimeEngine: RegimeEngine;
  private readonly qmonEngine: QmonEngine | null;
  private lastStructuredResult: StructuredSignalResult | null;
  private lastRegimes: RegimeResult;
  private lastRegimeEvents: readonly RegimeEvent[];
  private runtimeExecutionStatus: RuntimeExecutionStatus | null;
  private executionMode: "paper" | "real";

  /**
   * @section constructor
   */

  public constructor(signalEngine: SignalEngine, regimeEngine: RegimeEngine, qmonEngine: QmonEngine | null = null, executionMode: "paper" | "real" = "paper") {
    this.signalEngine = signalEngine;
    this.regimeEngine = regimeEngine;
    this.qmonEngine = qmonEngine;
    this.lastStructuredResult = null;
    this.lastRegimes = {};
    this.lastRegimeEvents = [];
    this.runtimeExecutionStatus = null;
    this.executionMode = executionMode;
  }

  /**
   * @section factory
   */

  public static createDefault(qmonEngine: QmonEngine | null = null, signalEngine?: SignalEngine, executionMode: "paper" | "real" = "paper"): HttpServerService {
    return new HttpServerService(signalEngine ?? SignalEngine.createDefault(), RegimeEngine.createDefault(), qmonEngine, executionMode);
  }

  /**
   * @section private:methods
   */

  private readHtmlDocument(filename: string): string | null {
    try {
      return readFileSync(join(PUBLIC_DIR, filename), "utf-8");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`HTML not found at ${filename}: ${message}`);
      return null;
    }
  }

  private buildQmonPayload(): Record<string, unknown> {
    const familyState = this.qmonEngine?.getFamilyState() ?? null;
    const populations =
      familyState?.populations.map((population) => {
        const qmons = population.qmons.map((qmon) => ({
          id: qmon.id,
          name: qmon.name,
          market: qmon.market,
          strategyId: qmon.strategyId,
          strategyName: qmon.strategyName,
          strategyDescription: qmon.strategyDescription,
          role: qmon.role,
          currentTrend: qmon.currentTrend,
          currentPaperPosition: qmon.paperPosition,
          currentWindowPnl: qmon.currentWindowPnl,
          metrics: qmon.metrics,
          strategyState: qmon.strategyState,
        }));

        return {
          market: population.market,
          currentTrend: population.currentTrend,
          currentWindowStartMs: population.currentWindowStartMs,
          activeChampionQmonId: population.activeChampionQmonId,
          realSeat: population.realSeat,
          qmons,
        };
      }) ?? [];

    return {
      generatedAt: Date.now(),
      mode: this.executionMode,
      populations,
      runtimeExecutionStatus: this.runtimeExecutionStatus,
    };
  }

  private buildQmonStatsPayload(): Record<string, unknown> {
    const familyState = this.qmonEngine?.getFamilyState() ?? null;
    const populations = familyState?.populations ?? [];
    const totalQmons = populations.reduce((runningQmonCount, population) => runningQmonCount + population.qmons.length, 0);
    const activeChampionCount = populations.filter((population) => population.activeChampionQmonId !== null).length;
    const totalPnl = populations.reduce(
      (runningPnl, population) => runningPnl + population.qmons.reduce((runningMarketPnl, qmon) => runningMarketPnl + qmon.metrics.totalPnl, 0),
      0,
    );
    const totalTrades = populations.reduce(
      (runningTradeCount, population) =>
        runningTradeCount + population.qmons.reduce((runningMarketTradeCount, qmon) => runningMarketTradeCount + qmon.metrics.totalTrades, 0),
      0,
    );

    return {
      generatedAt: Date.now(),
      totalPopulations: populations.length,
      totalQmons,
      activeChampionCount,
      totalPnl,
      totalTrades,
    };
  }

  /**
   * @section public:methods
   */

  public updateSignals(snapshots: readonly Snapshot[]): void {
    this.lastStructuredResult = this.signalEngine.calculateStructured(snapshots);

    const regimeEvaluation = this.regimeEngine.evaluate(this.lastStructuredResult);

    this.lastRegimes = regimeEvaluation.states;
    this.lastRegimeEvents = regimeEvaluation.events;
  }

  public getLastStructuredSignals(): StructuredSignalResult | null {
    return this.lastStructuredResult;
  }

  public getLastRegimes(): RegimeResult {
    return this.lastRegimes;
  }

  public setRuntimeExecutionStatus(runtimeExecutionStatus: RuntimeExecutionStatus): void {
    this.runtimeExecutionStatus = runtimeExecutionStatus;
    this.executionMode = runtimeExecutionStatus.mode;
  }

  public buildServer(): ServerType {
    const app = new Hono();

    app.get("/", (context) => {
      const indexHtml = this.readHtmlDocument("index.html");

      if (indexHtml === null) {
        return context.text("Dashboard not found", 404);
      }

      return context.html(indexHtml);
    });
    app.get("/dashboard", (context) => context.redirect("/"));
    app.get("/signals.html", (context) => {
      const signalsHtml = this.readHtmlDocument("signals.html");

      if (signalsHtml === null) {
        return context.text("Signals dashboard not found", 404);
      }

      return context.html(signalsHtml);
    });
    app.get("/api/signals/structured", (context) =>
      context.json({
        generatedAt: Date.now(),
        structuredSignals: this.lastStructuredResult,
        regimes: this.lastRegimes,
        regimeEvents: this.lastRegimeEvents,
      }),
    );
    app.get("/api/qmons", (context) => context.json(this.buildQmonPayload()));
    app.get("/api/qmons/stats", (context) => context.json(this.buildQmonStatsPayload()));

    return createAdaptorServer({
      fetch: app.fetch,
    });
  }
}
