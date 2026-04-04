/**
 * @section imports:externals
 */

import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * @section consts
 */

const MAX_RECENT_EVENT_CACHE_SIZE = 5000;
const MAX_HYDRATION_DAYS = 30;
const RANGE_TO_DAYS = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
} as const;

/**
 * @section types
 */

type ValidationLogValue = boolean | number | string | null | readonly string[];

type ValidationLogPayload = Record<string, ValidationLogValue>;

export type DiagnosticRange = keyof typeof RANGE_TO_DAYS;

export type DiagnosticCategory = "execution" | "position" | "window" | "warning" | "lifecycle";

export type DiagnosticSeverity = "info" | "warn" | "error";

type EventFilter = {
  market?: string;
  category?: DiagnosticCategory;
  range: DiagnosticRange;
  limit: number;
};

type QmonCounterMap = Record<string, number>;

type DiagnosticsAggregate = {
  totalEvents: number;
  eventTypeCounts: Record<string, number>;
  categoryCounts: Record<DiagnosticCategory, number>;
  warningCounts: Record<string, number>;
  qmonEventCounts: QmonCounterMap;
  qmonExpireCounts: QmonCounterMap;
  qmonWarningCounts: QmonCounterMap;
  orderCreatedCount: number;
  orderCheckedCount: number;
  orderFilledCount: number;
  orderPartialFillCount: number;
  orderExpiredCount: number;
  liveOrderPostedCount: number;
  liveOrderConfirmedCount: number;
  priceImpactBpsSum: number;
  priceImpactBpsSamples: number;
  slippageRejectedCount: number;
  entryFillBelowMinimumCount: number;
  positionOpenedCount: number;
  positionClosedCount: number;
  seatPositionOpenedCount: number;
  seatPositionClosedCount: number;
  totalCashflow: number;
  totalRealizedPnl: number;
  seatCashflow: number;
  seatRealizedPnl: number;
  winningCloseCount: number;
  losingCloseCount: number;
  holdDurationMsSum: number;
  holdDurationSamples: number;
  leaderSeatInitializedCount: number;
  leaderWindowFinalizedCount: number;
  championChangeCount: number;
  qmonBornCount: number;
  qmonDiedCount: number;
};

type DiagnosticsDailySummary = {
  date: string;
  updatedAt: number;
  global: DiagnosticsAggregate;
  markets: Record<string, DiagnosticsAggregate>;
};

export type DiagnosticsFlag = {
  readonly key: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly market: string | null;
};

export type DiagnosticsMarketSummary = {
  readonly market: string;
  readonly totalEvents: number;
  readonly warningCount: number;
  readonly seatRealizedPnl: number;
  readonly totalRealizedPnl: number;
  readonly seatTradeCount: number;
  readonly fillRate: number;
  readonly paperFillRate: number;
  readonly realFillRate: number;
  readonly orderFailureRate: number;
  readonly avgPriceImpactBps: number | null;
  readonly slippageRejectedCount: number;
  readonly entryFillBelowMinimumCount: number;
  readonly championChangeCount: number;
  readonly flags: readonly DiagnosticsFlag[];
  readonly noisyQmons: readonly { qmonId: string; eventCount: number; expireCount: number; warningCount: number }[];
};

export type DiagnosticsOverview = {
  readonly range: DiagnosticRange;
  readonly generatedAt: number;
  readonly totals: {
    readonly totalEvents: number;
    readonly warningCount: number;
    readonly seatRealizedPnl: number;
    readonly totalRealizedPnl: number;
    readonly fillRate: number;
    readonly paperFillRate: number;
    readonly realFillRate: number;
    readonly orderFailureRate: number;
    readonly avgPriceImpactBps: number | null;
    readonly seatTradeCount: number;
  };
  readonly flags: readonly DiagnosticsFlag[];
  readonly markets: readonly DiagnosticsMarketSummary[];
};

export type ValidationLogEvent = ValidationLogPayload & {
  readonly eventId: string;
  readonly type: string;
  readonly eventType: string;
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  readonly timestamp: number;
  readonly market: string | null;
  readonly qmonId: string | null;
  readonly isSeat: boolean;
  readonly marketStartMs: number | null;
  readonly marketEndMs: number | null;
};

export type CpnlLogRow = {
  readonly id: string;
  readonly timestamp: number;
  readonly market: string;
  readonly qmonId: string;
  readonly eventType: "position-opened" | "position-closed";
  readonly flow: "entry" | "exit";
  readonly message: string;
  readonly detail: string;
  readonly cashflow: number;
};

/**
 * @section class
 */

export class QmonValidationLogService {
  /**
   * @section private:attributes
   */

  private readonly diagnosticsRootPath: string;
  private readonly recentEventCacheLimit: number;
  private recentEventCache: ValidationLogEvent[];
  private readonly summaryCache: Map<string, DiagnosticsDailySummary>;
  private readonly dirtySummaryDates: Set<string>;
  private isRecentEventCacheHydrated: boolean;
  private cpnlSessionStartedAt: number | null;
  private writeSequence: number;
  private writeQueue: Promise<void>;

  /**
   * @section constructor
   */

  public constructor(storagePath: string) {
    this.diagnosticsRootPath = storagePath.endsWith(".jsonl") ? join(dirname(storagePath), "qmon-diagnostics") : storagePath;
    this.recentEventCacheLimit = MAX_RECENT_EVENT_CACHE_SIZE;
    this.recentEventCache = [];
    this.summaryCache = new Map();
    this.dirtySummaryDates = new Set();
    this.isRecentEventCacheHydrated = false;
    this.cpnlSessionStartedAt = null;
    this.writeSequence = 0;
    this.writeQueue = Promise.resolve();
  }

  /**
   * @section factory
   */

  public static createDefault(storagePath = "./data/qmon-diagnostics"): QmonValidationLogService {
    return new QmonValidationLogService(storagePath);
  }

  /**
   * @section private:methods
   */

  private createEmptyAggregate(): DiagnosticsAggregate {
    const aggregate: DiagnosticsAggregate = {
      totalEvents: 0,
      eventTypeCounts: {},
      categoryCounts: {
        execution: 0,
        position: 0,
        window: 0,
        warning: 0,
        lifecycle: 0,
      },
      warningCounts: {},
      qmonEventCounts: {},
      qmonExpireCounts: {},
      qmonWarningCounts: {},
      orderCreatedCount: 0,
      orderCheckedCount: 0,
      orderFilledCount: 0,
      orderPartialFillCount: 0,
      orderExpiredCount: 0,
      liveOrderPostedCount: 0,
      liveOrderConfirmedCount: 0,
      priceImpactBpsSum: 0,
      priceImpactBpsSamples: 0,
      slippageRejectedCount: 0,
      entryFillBelowMinimumCount: 0,
      positionOpenedCount: 0,
      positionClosedCount: 0,
      seatPositionOpenedCount: 0,
      seatPositionClosedCount: 0,
      totalCashflow: 0,
      totalRealizedPnl: 0,
      seatCashflow: 0,
      seatRealizedPnl: 0,
      winningCloseCount: 0,
      losingCloseCount: 0,
      holdDurationMsSum: 0,
      holdDurationSamples: 0,
      leaderSeatInitializedCount: 0,
      leaderWindowFinalizedCount: 0,
      championChangeCount: 0,
      qmonBornCount: 0,
      qmonDiedCount: 0,
    };

    return aggregate;
  }

  private cloneAggregate(aggregate: DiagnosticsAggregate): DiagnosticsAggregate {
    const clonedAggregate: DiagnosticsAggregate = {
      ...aggregate,
      eventTypeCounts: { ...aggregate.eventTypeCounts },
      categoryCounts: { ...aggregate.categoryCounts },
      warningCounts: { ...aggregate.warningCounts },
      qmonEventCounts: { ...aggregate.qmonEventCounts },
      qmonExpireCounts: { ...aggregate.qmonExpireCounts },
      qmonWarningCounts: { ...aggregate.qmonWarningCounts },
    };

    return clonedAggregate;
  }

  private createEmptyDailySummary(date: string): DiagnosticsDailySummary {
    const dailySummary: DiagnosticsDailySummary = {
      date,
      updatedAt: Date.now(),
      global: this.createEmptyAggregate(),
      markets: {},
    };

    return dailySummary;
  }

  private getUtcDateString(timestamp: number): string {
    const utcDateString = new Date(timestamp).toISOString().slice(0, 10);

    return utcDateString;
  }

  private getEventFilePath(event: ValidationLogEvent): string {
    const utcDateString = this.getUtcDateString(event.timestamp);
    const marketSegment = event.market ?? "_system";
    const eventFilePath = join(this.diagnosticsRootPath, "events", utcDateString, `${marketSegment}.jsonl`);

    return eventFilePath;
  }

  private getSummaryFilePath(date: string): string {
    const summaryFilePath = join(this.diagnosticsRootPath, "summaries", `${date}.json`);

    return summaryFilePath;
  }

  private resolveEventCategory(eventType: string): DiagnosticCategory {
    let category: DiagnosticCategory = "lifecycle";

    if (eventType.startsWith("paper-order-") || eventType.startsWith("live-")) {
      category = "execution";
    } else {
      if (eventType === "position-opened" || eventType === "position-closed") {
        category = "position";
      } else {
        if (eventType === "leader-seat-initialized" || eventType === "leader-window-finalized") {
          category = "window";
        } else {
          if (eventType === "validation-warning") {
            category = "warning";
          }
        }
      }
    }

    return category;
  }

  private resolveSeverity(eventType: string): DiagnosticSeverity {
    let severity: DiagnosticSeverity = "info";

    if (eventType === "validation-warning") {
      severity = "warn";
    }

    return severity;
  }

  private createEvent(eventType: string, payload: ValidationLogPayload): ValidationLogEvent {
    const timestamp = Date.now();
    const category = this.resolveEventCategory(eventType);
    const severity = this.resolveSeverity(eventType);
    const normalizedMarket = typeof payload.market === "string" ? payload.market : null;
    const normalizedQmonId =
      typeof payload.qmonId === "string"
        ? payload.qmonId
        : typeof payload.childQmonId === "string"
          ? payload.childQmonId
          : typeof payload.deadQmonId === "string"
            ? payload.deadQmonId
            : null;
    const event: ValidationLogEvent = {
      ...payload,
      eventId: `${timestamp}-${String(this.writeSequence).padStart(8, "0")}-${eventType}-${normalizedMarket ?? "system"}-${normalizedQmonId ?? "none"}`,
      type: eventType,
      eventType,
      category,
      severity,
      timestamp,
      market: normalizedMarket,
      qmonId: normalizedQmonId,
      isSeat: payload.isSeat === true,
      marketStartMs: typeof payload.marketStartMs === "number" ? payload.marketStartMs : null,
      marketEndMs: typeof payload.marketEndMs === "number" ? payload.marketEndMs : null,
    };

    return event;
  }

  private serializeEvent(event: ValidationLogEvent): string {
    const serializedEvent = `${JSON.stringify(event)}\n`;

    return serializedEvent;
  }

  private async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  private appendRecentEvent(event: ValidationLogEvent): void {
    this.recentEventCache.push(event);

    if (this.recentEventCache.length > this.recentEventCacheLimit) {
      this.recentEventCache.splice(0, this.recentEventCache.length - this.recentEventCacheLimit);
    }
  }

  private incrementCounter(counterMap: Record<string, number>, key: string | null): void {
    if (key !== null && key !== "") {
      counterMap[key] = (counterMap[key] ?? 0) + 1;
    }
  }

  private shouldIgnoreWarningCode(warningCode: string | null): boolean {
    const shouldIgnoreWarningCode = warningCode?.startsWith("tradeability-") ?? false;

    return shouldIgnoreWarningCode;
  }

  private applyEventToAggregate(aggregate: DiagnosticsAggregate, event: ValidationLogEvent): DiagnosticsAggregate {
    const nextAggregate = this.cloneAggregate(aggregate);
    const warningCode = typeof event.warningCode === "string" ? event.warningCode : null;
    const eventQmonId = event.qmonId;
    const netPnl = typeof event.netPnl === "number" ? event.netPnl : null;
    const cashflow = typeof event.cashflow === "number" ? event.cashflow : null;
    const priceImpactBps = typeof event.priceImpactBps === "number" ? event.priceImpactBps : null;
    const enteredAt = typeof event.enteredAt === "number" ? event.enteredAt : null;

    nextAggregate.totalEvents += 1;
    nextAggregate.eventTypeCounts[event.eventType] = (nextAggregate.eventTypeCounts[event.eventType] ?? 0) + 1;
    nextAggregate.categoryCounts[event.category] += 1;
    this.incrementCounter(nextAggregate.qmonEventCounts, eventQmonId);

    if (event.eventType === "paper-order-created") {
      nextAggregate.orderCreatedCount += 1;
    }

    if (event.eventType === "paper-order-checked") {
      nextAggregate.orderCheckedCount += 1;
    }

    if (event.eventType === "paper-order-filled") {
      nextAggregate.orderFilledCount += 1;
    }

    if (event.eventType === "paper-order-partial-fill") {
      nextAggregate.orderPartialFillCount += 1;
    }

    if (event.eventType === "paper-order-expired") {
      nextAggregate.orderExpiredCount += 1;
      this.incrementCounter(nextAggregate.qmonExpireCounts, eventQmonId);
    }

    if (event.eventType === "live-order-posted") {
      nextAggregate.liveOrderPostedCount += 1;
    }

    if (event.eventType === "live-order-confirmed") {
      nextAggregate.liveOrderConfirmedCount += 1;
    }

    if (priceImpactBps !== null) {
      nextAggregate.priceImpactBpsSum += priceImpactBps;
      nextAggregate.priceImpactBpsSamples += 1;
    }

    if (event.eventType === "position-opened") {
      nextAggregate.positionOpenedCount += 1;

      if (event.isSeat) {
        nextAggregate.seatPositionOpenedCount += 1;
      }
    }

    if (event.eventType === "position-closed") {
      nextAggregate.positionClosedCount += 1;

      if (netPnl !== null) {
        nextAggregate.totalRealizedPnl += netPnl;

        if (netPnl >= 0) {
          nextAggregate.winningCloseCount += 1;
        } else {
          nextAggregate.losingCloseCount += 1;
        }
      }

      if (cashflow !== null) {
        nextAggregate.totalCashflow += cashflow;
      }

      if (enteredAt !== null && event.timestamp >= enteredAt) {
        nextAggregate.holdDurationMsSum += event.timestamp - enteredAt;
        nextAggregate.holdDurationSamples += 1;
      }

      if (event.isSeat) {
        nextAggregate.seatPositionClosedCount += 1;

        if (netPnl !== null) {
          nextAggregate.seatRealizedPnl += netPnl;
        }

        if (cashflow !== null) {
          nextAggregate.seatCashflow += cashflow;
        }
      }
    }

    if (event.eventType === "leader-seat-initialized") {
      nextAggregate.leaderSeatInitializedCount += 1;
    }

    if (event.eventType === "leader-window-finalized") {
      nextAggregate.leaderWindowFinalizedCount += 1;

      if (typeof event.nextLeaderQmonId === "string" && event.nextLeaderQmonId !== event.qmonId) {
        nextAggregate.championChangeCount += 1;
      }
    }

    if (event.eventType === "qmon-born") {
      nextAggregate.qmonBornCount += 1;
    }

    if (event.eventType === "qmon-died") {
      nextAggregate.qmonDiedCount += 1;
    }

    if (event.eventType === "validation-warning" && warningCode !== null && !this.shouldIgnoreWarningCode(warningCode)) {
      nextAggregate.warningCounts[warningCode] = (nextAggregate.warningCounts[warningCode] ?? 0) + 1;
      this.incrementCounter(nextAggregate.qmonWarningCounts, eventQmonId);

      if (warningCode === "slippage-rejected") {
        nextAggregate.slippageRejectedCount += 1;
      }

      if (warningCode === "entry-fill-below-minimum") {
        nextAggregate.entryFillBelowMinimumCount += 1;
      }
    }

    return nextAggregate;
  }

  private mergeAggregate(left: DiagnosticsAggregate, right: DiagnosticsAggregate): DiagnosticsAggregate {
    const mergedAggregate = this.cloneAggregate(left);

    mergedAggregate.totalEvents += right.totalEvents;
    mergedAggregate.orderCreatedCount += right.orderCreatedCount;
    mergedAggregate.orderCheckedCount += right.orderCheckedCount;
    mergedAggregate.orderFilledCount += right.orderFilledCount;
    mergedAggregate.orderPartialFillCount += right.orderPartialFillCount;
    mergedAggregate.orderExpiredCount += right.orderExpiredCount;
    mergedAggregate.liveOrderPostedCount += right.liveOrderPostedCount;
    mergedAggregate.liveOrderConfirmedCount += right.liveOrderConfirmedCount;
    mergedAggregate.priceImpactBpsSum += right.priceImpactBpsSum;
    mergedAggregate.priceImpactBpsSamples += right.priceImpactBpsSamples;
    mergedAggregate.slippageRejectedCount += right.slippageRejectedCount;
    mergedAggregate.entryFillBelowMinimumCount += right.entryFillBelowMinimumCount;
    mergedAggregate.positionOpenedCount += right.positionOpenedCount;
    mergedAggregate.positionClosedCount += right.positionClosedCount;
    mergedAggregate.seatPositionOpenedCount += right.seatPositionOpenedCount;
    mergedAggregate.seatPositionClosedCount += right.seatPositionClosedCount;
    mergedAggregate.totalCashflow += right.totalCashflow;
    mergedAggregate.totalRealizedPnl += right.totalRealizedPnl;
    mergedAggregate.seatCashflow += right.seatCashflow;
    mergedAggregate.seatRealizedPnl += right.seatRealizedPnl;
    mergedAggregate.winningCloseCount += right.winningCloseCount;
    mergedAggregate.losingCloseCount += right.losingCloseCount;
    mergedAggregate.holdDurationMsSum += right.holdDurationMsSum;
    mergedAggregate.holdDurationSamples += right.holdDurationSamples;
    mergedAggregate.leaderSeatInitializedCount += right.leaderSeatInitializedCount;
    mergedAggregate.leaderWindowFinalizedCount += right.leaderWindowFinalizedCount;
    mergedAggregate.championChangeCount += right.championChangeCount;
    mergedAggregate.qmonBornCount += right.qmonBornCount;
    mergedAggregate.qmonDiedCount += right.qmonDiedCount;

    for (const [eventType, count] of Object.entries(right.eventTypeCounts)) {
      mergedAggregate.eventTypeCounts[eventType] = (mergedAggregate.eventTypeCounts[eventType] ?? 0) + count;
    }

    for (const categoryKey of Object.keys(right.categoryCounts) as DiagnosticCategory[]) {
      mergedAggregate.categoryCounts[categoryKey] += right.categoryCounts[categoryKey];
    }

    for (const [warningCode, count] of Object.entries(right.warningCounts)) {
      mergedAggregate.warningCounts[warningCode] = (mergedAggregate.warningCounts[warningCode] ?? 0) + count;
    }

    for (const [qmonId, count] of Object.entries(right.qmonEventCounts)) {
      mergedAggregate.qmonEventCounts[qmonId] = (mergedAggregate.qmonEventCounts[qmonId] ?? 0) + count;
    }

    for (const [qmonId, count] of Object.entries(right.qmonExpireCounts)) {
      mergedAggregate.qmonExpireCounts[qmonId] = (mergedAggregate.qmonExpireCounts[qmonId] ?? 0) + count;
    }

    for (const [qmonId, count] of Object.entries(right.qmonWarningCounts)) {
      mergedAggregate.qmonWarningCounts[qmonId] = (mergedAggregate.qmonWarningCounts[qmonId] ?? 0) + count;
    }

    return mergedAggregate;
  }

  private buildDailySummaryWithEvent(event: ValidationLogEvent, existingSummary: DiagnosticsDailySummary | null): DiagnosticsDailySummary {
    const date = this.getUtcDateString(event.timestamp);
    const baseSummary = existingSummary ?? this.createEmptyDailySummary(date);
    const marketKey = event.market;
    const currentMarketAggregate = marketKey !== null ? (baseSummary.markets[marketKey] ?? this.createEmptyAggregate()) : null;
    const nextGlobalAggregate = this.applyEventToAggregate(baseSummary.global, event);
    const nextMarkets = { ...baseSummary.markets };

    if (marketKey !== null && currentMarketAggregate !== null) {
      nextMarkets[marketKey] = this.applyEventToAggregate(currentMarketAggregate, event);
    }

    const nextSummary: DiagnosticsDailySummary = {
      date,
      updatedAt: Date.now(),
      global: nextGlobalAggregate,
      markets: nextMarkets,
    };

    return nextSummary;
  }

  private async loadDailySummary(date: string): Promise<DiagnosticsDailySummary | null> {
    let dailySummary: DiagnosticsDailySummary | null = this.summaryCache.get(date) ?? null;

    if (dailySummary === null) {
      try {
        const rawSummary = await readFile(this.getSummaryFilePath(date), "utf-8");
        dailySummary = JSON.parse(rawSummary) as DiagnosticsDailySummary;
        this.summaryCache.set(date, dailySummary);
      } catch (error: unknown) {
        dailySummary = null;

        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to load diagnostics summary ${date}: ${message}`);
        }
      }
    }

    return dailySummary;
  }

  private async persistSummary(summary: DiagnosticsDailySummary): Promise<void> {
    await this.ensureDir(dirname(this.getSummaryFilePath(summary.date)));
    await writeFile(this.getSummaryFilePath(summary.date), JSON.stringify(summary, null, 2), "utf-8");
    this.summaryCache.set(summary.date, summary);
  }

  private async persistDirtySummaries(): Promise<void> {
    const dirtyDates = [...this.dirtySummaryDates];

    for (const date of dirtyDates) {
      const summary = this.summaryCache.get(date) ?? null;

      if (summary !== null) {
        await this.persistSummary(summary);
      }

      this.dirtySummaryDates.delete(date);
    }
  }

  private async appendRawEvent(event: ValidationLogEvent): Promise<void> {
    const eventFilePath = this.getEventFilePath(event);
    await this.ensureDir(dirname(eventFilePath));
    await appendFile(eventFilePath, this.serializeEvent(event), "utf-8");
  }

  private parseRawEvents(rawLog: string): ValidationLogEvent[] {
    const parsedEvents: ValidationLogEvent[] = [];
    const rawLines = rawLog.split("\n");

    for (let index = 0; index < rawLines.length; index += 1) {
      const rawLine = rawLines[index]?.trim() ?? "";

      if (rawLine !== "") {
        try {
          parsedEvents.push(JSON.parse(rawLine) as ValidationLogEvent);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Skipping malformed validation log line at index ${index}: ${message}`);
        }
      }
    }

    return parsedEvents;
  }

  private async listRecentEventFilePaths(): Promise<readonly string[]> {
    const recentEventFilePaths: string[] = [];
    const eventsRootPath = join(this.diagnosticsRootPath, "events");

    try {
      const dateDirectories = await readdir(eventsRootPath, { withFileTypes: true });
      const sortedDateDirectories = dateDirectories
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort((left, right) => right.localeCompare(left))
        .slice(0, MAX_HYDRATION_DAYS);

      for (const dateDirectory of sortedDateDirectories) {
        const datePath = join(eventsRootPath, dateDirectory);
        const fileEntries = await readdir(datePath, { withFileTypes: true });

        for (const fileEntry of fileEntries) {
          if (fileEntry.isFile() && fileEntry.name.endsWith(".jsonl")) {
            recentEventFilePaths.push(join(datePath, fileEntry.name));
          }
        }
      }
    } catch (error: unknown) {
      recentEventFilePaths.length = 0;

      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to list diagnostics event files: ${message}`);
      }
    }

    return recentEventFilePaths;
  }

  private async hydrateRecentEventCache(): Promise<void> {
    if (!this.isRecentEventCacheHydrated) {
      const hydratedEvents: ValidationLogEvent[] = [];

      try {
        const eventFilePaths = await this.listRecentEventFilePaths();

        for (const eventFilePath of eventFilePaths) {
          const rawLog = await readFile(eventFilePath, "utf-8");
          hydratedEvents.push(...this.parseRawEvents(rawLog));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Validation log cache hydration skipped at ${this.diagnosticsRootPath}: ${message}`);
      }

      hydratedEvents.sort((left, right) => left.timestamp - right.timestamp);
      this.recentEventCache = hydratedEvents.slice(-this.recentEventCacheLimit);
      this.isRecentEventCacheHydrated = true;
    }
  }

  private normalizeLimit(limit: number): number {
    const normalizedLimit = Math.max(1, Math.trunc(limit));

    return normalizedLimit;
  }

  private async readRecentFilteredEvents(limit: number, shouldInclude: (event: ValidationLogEvent) => boolean): Promise<readonly ValidationLogEvent[]> {
    let recentEvents: ValidationLogEvent[] = [];

    await this.flush();
    await this.hydrateRecentEventCache();
    recentEvents = this.recentEventCache.filter(shouldInclude).slice(-this.normalizeLimit(limit));

    return recentEvents;
  }

  private async readSessionEventsFromCache(filter: EventFilter): Promise<readonly ValidationLogEvent[]> {
    const matchingEvents: ValidationLogEvent[] = [];
    const sessionStartTimestamp = this.cpnlSessionStartedAt ?? 0;

    await this.flush();
    await this.hydrateRecentEventCache();

    for (const cachedEvent of this.recentEventCache) {
      const isInsideSession = cachedEvent.timestamp >= sessionStartTimestamp;
      const matchesMarket = filter.market === undefined || cachedEvent.market === filter.market;
      const matchesCategory = filter.category === undefined || cachedEvent.category === filter.category;

      if (isInsideSession && matchesMarket && matchesCategory) {
        matchingEvents.push(cachedEvent);
      }
    }

    return matchingEvents.slice(-filter.limit);
  }

  private isPositionCashflowEvent(event: ValidationLogEvent, market?: string): boolean {
    const isMatchingMarket = market === undefined || event.market === market;
    const hasCashflow = typeof event.cashflow === "number";
    const isPositionCashflow = event.eventType === "position-opened" || event.eventType === "position-closed";
    const isCashflowEvent = isMatchingMarket && hasCashflow && isPositionCashflow;

    return isCashflowEvent;
  }

  private formatCpnlFlowMessage(event: ValidationLogEvent): string {
    let message = "CASHFLOW";

    if (event.eventType === "position-opened") {
      message = String(event.action ?? "OPEN");
    } else if (event.reason === "market-settled") {
      const cashflow = typeof event.cashflow === "number" ? event.cashflow : 0;
      const isWinningSettlement = cashflow > 0;

      if (event.action === "BUY_UP") {
        message = isWinningSettlement ? "SETTLE_UP_WIN" : "SETTLE_UP_LOSS";
      } else if (event.action === "BUY_DOWN") {
        message = isWinningSettlement ? "SETTLE_DOWN_WIN" : "SETTLE_DOWN_LOSS";
      } else {
        message = isWinningSettlement ? "SETTLE_WIN" : "SETTLE_LOSS";
      }
    } else if (event.action === "BUY_UP") {
      message = "SELL_UP";
    } else if (event.action === "BUY_DOWN") {
      message = "SELL_DOWN";
    } else {
      message = "CLOSE";
    }

    return message;
  }

  private formatCpnlPrice(price: number | null | undefined): string {
    let formattedPrice = "—";

    if (typeof price === "number") {
      formattedPrice = price.toFixed(4);
    }

    return formattedPrice;
  }

  private formatCpnlDetail(event: ValidationLogEvent): string {
    const qmonId = event.qmonId ?? "—";
    const shareCount = typeof event.shareCount === "number" ? `${event.shareCount.toFixed(2)} sh` : "—";
    const priceText =
      event.eventType === "position-opened"
        ? `IN ${this.formatCpnlPrice((event.entryPrice as number | null | undefined) ?? (event.executionPrice as number | null | undefined))}`
        : `IN ${this.formatCpnlPrice(event.entryPrice as number | null | undefined)} · OUT ${this.formatCpnlPrice((event.exitPrice as number | null | undefined) ?? (event.executionPrice as number | null | undefined))}`;
    const reasonText = event.eventType === "position-closed" ? ` · ${String(event.reason ?? "closed")}` : "";
    const formattedDetail = `${qmonId} · TAKER · ${shareCount} · ${priceText}${reasonText}`;

    return formattedDetail;
  }

  private buildCpnlLogRow(event: ValidationLogEvent): CpnlLogRow {
    const cpnlLogRow: CpnlLogRow = {
      id: event.eventId,
      timestamp: event.timestamp,
      market: event.market ?? "—",
      qmonId: event.qmonId ?? "—",
      eventType: event.eventType as "position-opened" | "position-closed",
      flow: event.eventType === "position-opened" ? "entry" : "exit",
      message: this.formatCpnlFlowMessage(event),
      detail: this.formatCpnlDetail(event),
      cashflow: event.cashflow as number,
    };

    return cpnlLogRow;
  }

  private async readPositionCashflowEventsFromRange(range: DiagnosticRange, limit: number, market?: string): Promise<readonly ValidationLogEvent[]> {
    const positionCashflowEvents: ValidationLogEvent[] = [];
    const normalizedLimit = this.normalizeLimit(limit);
    const rangeDates = [...this.getRangeDates(range)].sort((left, right) => left.localeCompare(right));
    const sessionStartTimestamp = this.cpnlSessionStartedAt;

    for (const date of rangeDates) {
      const dateDirectoryPath = join(this.diagnosticsRootPath, "events", date);

      try {
        const fileEntries = await readdir(dateDirectoryPath, { withFileTypes: true });

        for (const fileEntry of fileEntries) {
          if (fileEntry.isFile() && fileEntry.name.endsWith(".jsonl")) {
            const isMarketFiltered = market !== undefined;
            const expectedFileName = `${market}.jsonl`;
            const shouldReadFile = !isMarketFiltered || fileEntry.name === expectedFileName;

            if (shouldReadFile) {
              const rawLog = await readFile(join(dateDirectoryPath, fileEntry.name), "utf-8");
              const parsedEvents = this.parseRawEvents(rawLog);

              for (const parsedEvent of parsedEvents) {
                const isInsideSession = sessionStartTimestamp === null || parsedEvent.timestamp >= sessionStartTimestamp;

                if (isInsideSession && this.isPositionCashflowEvent(parsedEvent, market)) {
                  positionCashflowEvents.push(parsedEvent);

                  if (positionCashflowEvents.length > normalizedLimit * 2) {
                    positionCashflowEvents.splice(0, positionCashflowEvents.length - normalizedLimit);
                  }
                }
              }
            }
          }
        }
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to read position cashflow events for ${date}: ${message}`);
        }
      }
    }

    return positionCashflowEvents.slice(-normalizedLimit);
  }

  private createAggregateFromRange(): DiagnosticsAggregate {
    const aggregate = this.createEmptyAggregate();

    return aggregate;
  }

  private getRangeDates(range: DiagnosticRange): readonly string[] {
    const rangeDates: string[] = [];
    const dayCount = RANGE_TO_DAYS[range];
    const now = new Date(Date.now());

    for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset, 0, 0, 0, 0));
      rangeDates.push(date.toISOString().slice(0, 10));
    }

    return rangeDates;
  }

  private async readAggregateForRange(
    range: DiagnosticRange,
  ): Promise<{ readonly global: DiagnosticsAggregate; readonly markets: Record<string, DiagnosticsAggregate> }> {
    if (this.cpnlSessionStartedAt !== null) {
      return this.readAggregateForCurrentSession(range);
    }

    const rangeDates = this.getRangeDates(range);
    const globalAggregate = this.createAggregateFromRange();
    const marketAggregates: Record<string, DiagnosticsAggregate> = {};

    for (const date of rangeDates) {
      const dailySummary = await this.loadDailySummary(date);

      if (dailySummary !== null) {
        const mergedGlobal = this.mergeAggregate(globalAggregate, dailySummary.global);

        Object.assign(globalAggregate, mergedGlobal);

        for (const [market, aggregate] of Object.entries(dailySummary.markets)) {
          const currentMarketAggregate = marketAggregates[market] ?? this.createAggregateFromRange();
          marketAggregates[market] = this.mergeAggregate(currentMarketAggregate, aggregate);
        }
      }
    }

    return {
      global: globalAggregate,
      markets: marketAggregates,
    };
  }

  private async readAggregateForCurrentSession(
    range: DiagnosticRange,
  ): Promise<{ readonly global: DiagnosticsAggregate; readonly markets: Record<string, DiagnosticsAggregate> }> {
    const sessionEvents = await this.readSessionEventsFromCache({
      range,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const sessionStartTimestamp = this.cpnlSessionStartedAt ?? 0;
    let globalAggregate = this.createAggregateFromRange();
    const marketAggregates: Record<string, DiagnosticsAggregate> = {};

    for (const event of sessionEvents) {
      if (event.timestamp >= sessionStartTimestamp) {
        globalAggregate = this.applyEventToAggregate(globalAggregate, event);

        if (event.market !== null) {
          const currentMarketAggregate = marketAggregates[event.market] ?? this.createAggregateFromRange();
          marketAggregates[event.market] = this.applyEventToAggregate(currentMarketAggregate, event);
        }
      }
    }

    return {
      global: globalAggregate,
      markets: marketAggregates,
    };
  }

  private calculateFillRate(aggregate: DiagnosticsAggregate): number {
    const denominator = aggregate.orderCreatedCount;
    const filledOrderEventCount = Math.min(aggregate.orderFilledCount + aggregate.orderPartialFillCount, aggregate.orderCreatedCount);
    const fillRate = denominator > 0 ? filledOrderEventCount / denominator : 0;

    return fillRate;
  }

  private calculateOrderFailureRate(aggregate: DiagnosticsAggregate): number {
    const denominator = aggregate.orderCreatedCount;
    const orderFailureRate = denominator > 0 ? aggregate.orderExpiredCount / denominator : 0;

    return orderFailureRate;
  }

  private calculateRealFillRate(aggregate: DiagnosticsAggregate): number {
    const denominator = aggregate.liveOrderPostedCount;
    const confirmedOrderCount = Math.min(aggregate.liveOrderConfirmedCount, aggregate.liveOrderPostedCount);
    const realFillRate = denominator > 0 ? confirmedOrderCount / denominator : 0;

    return realFillRate;
  }

  private calculateAvgPriceImpactBps(aggregate: DiagnosticsAggregate): number | null {
    const avgPriceImpactBps = aggregate.priceImpactBpsSamples > 0 ? aggregate.priceImpactBpsSum / aggregate.priceImpactBpsSamples : null;

    return avgPriceImpactBps;
  }

  private buildFlags(market: string | null, aggregate: DiagnosticsAggregate): readonly DiagnosticsFlag[] {
    const flags: DiagnosticsFlag[] = [];
    const orderFailureRate = this.calculateOrderFailureRate(aggregate);
    const fillRate = this.calculateFillRate(aggregate);

    if (aggregate.orderCreatedCount >= 20 && orderFailureRate >= 0.7) {
      flags.push({
        key: `high-order-failure-${market ?? "global"}`,
        severity: "warn",
        message: `High order failure rate (${(orderFailureRate * 100).toFixed(1)}%)`,
        market,
      });
    }

    if (aggregate.slippageRejectedCount >= 3) {
      flags.push({
        key: `slippage-cluster-${market ?? "global"}`,
        severity: "warn",
        message: `${aggregate.slippageRejectedCount} slippage rejections in range`,
        market,
      });
    }

    if (aggregate.orderCreatedCount >= 20 && aggregate.seatPositionClosedCount === 0) {
      flags.push({
        key: `no-seat-cashflow-${market ?? "global"}`,
        severity: "warn",
        message: "Execution activity without seat cashflow",
        market,
      });
    }

    if (aggregate.leaderWindowFinalizedCount >= 3 && aggregate.seatPositionClosedCount === 0) {
      flags.push({
        key: `no-seat-trades-${market ?? "global"}`,
        severity: "warn",
        message: "No seat trades recorded across finalized windows",
        market,
      });
    }

    if (aggregate.orderCreatedCount >= 20 && fillRate <= 0.15) {
      flags.push({
        key: `low-fill-rate-${market ?? "global"}`,
        severity: "warn",
        message: `Low order fill rate (${(fillRate * 100).toFixed(1)}%)`,
        market,
      });
    }

    return flags;
  }

  private buildNoisyQmons(aggregate: DiagnosticsAggregate): readonly { qmonId: string; eventCount: number; expireCount: number; warningCount: number }[] {
    const noisyQmons = Object.keys(aggregate.qmonEventCounts)
      .map((qmonId) => ({
        qmonId,
        eventCount: aggregate.qmonEventCounts[qmonId] ?? 0,
        expireCount: aggregate.qmonExpireCounts[qmonId] ?? 0,
        warningCount: aggregate.qmonWarningCounts[qmonId] ?? 0,
      }))
      .sort((left, right) => {
        const eventDelta = right.eventCount - left.eventCount;
        const expireDelta = right.expireCount - left.expireCount;
        const warningDelta = right.warningCount - left.warningCount;
        let sortValue = eventDelta;

        if (sortValue === 0) {
          sortValue = expireDelta;
        }

        if (sortValue === 0) {
          sortValue = warningDelta;
        }

        return sortValue;
      })
      .slice(0, 5);

    return noisyQmons;
  }

  private buildMarketSummary(market: string, aggregate: DiagnosticsAggregate): DiagnosticsMarketSummary {
    const warningCount = Object.values(aggregate.warningCounts).reduce((runningCount, count) => runningCount + count, 0);
    const marketSummary: DiagnosticsMarketSummary = {
      market,
      totalEvents: aggregate.totalEvents,
      warningCount,
      seatRealizedPnl: aggregate.seatRealizedPnl,
      totalRealizedPnl: aggregate.totalRealizedPnl,
      seatTradeCount: aggregate.seatPositionClosedCount,
      fillRate: this.calculateFillRate(aggregate),
      paperFillRate: this.calculateFillRate(aggregate),
      realFillRate: this.calculateRealFillRate(aggregate),
      orderFailureRate: this.calculateOrderFailureRate(aggregate),
      avgPriceImpactBps: this.calculateAvgPriceImpactBps(aggregate),
      slippageRejectedCount: aggregate.slippageRejectedCount,
      entryFillBelowMinimumCount: aggregate.entryFillBelowMinimumCount,
      championChangeCount: aggregate.championChangeCount,
      flags: this.buildFlags(market, aggregate),
      noisyQmons: this.buildNoisyQmons(aggregate),
    };

    return marketSummary;
  }

  private async readEventsFromRange(filter: EventFilter): Promise<readonly ValidationLogEvent[]> {
    if (this.cpnlSessionStartedAt !== null) {
      return this.readSessionEventsFromCache(filter);
    }

    const matchingEvents: ValidationLogEvent[] = [];
    const rangeDates = [...this.getRangeDates(filter.range)].sort((left, right) => left.localeCompare(right));

    for (const date of rangeDates) {
      const dateDirectoryPath = join(this.diagnosticsRootPath, "events", date);

      try {
        const fileEntries = await readdir(dateDirectoryPath, { withFileTypes: true });

        for (const fileEntry of fileEntries) {
          if (fileEntry.isFile() && fileEntry.name.endsWith(".jsonl")) {
            const isMarketFiltered = filter.market !== undefined;
            const expectedFileName = `${filter.market}.jsonl`;
            const shouldReadFile = !isMarketFiltered || fileEntry.name === expectedFileName;

            if (shouldReadFile) {
              const rawLog = await readFile(join(dateDirectoryPath, fileEntry.name), "utf-8");
              const parsedEvents = this.parseRawEvents(rawLog);

              for (const parsedEvent of parsedEvents) {
                const matchesMarket = filter.market === undefined || parsedEvent.market === filter.market;
                const matchesCategory = filter.category === undefined || parsedEvent.category === filter.category;

                if (matchesMarket && matchesCategory) {
                  matchingEvents.push(parsedEvent);

                  if (matchingEvents.length > filter.limit * 2) {
                    matchingEvents.splice(0, matchingEvents.length - filter.limit);
                  }
                }
              }
            }
          }
        }
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to read diagnostics range events for ${date}: ${message}`);
        }
      }
    }

    matchingEvents.sort((left, right) => left.timestamp - right.timestamp);

    return matchingEvents.slice(-filter.limit);
  }

  private async persistQueuedWrite(event: ValidationLogEvent, previousWriteQueue: Promise<void>): Promise<void> {
    try {
      await previousWriteQueue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Previous diagnostics write failed: ${message}`);
    }

    try {
      const shouldPersistRawEvent = this.shouldPersistRawEvent(event);
      this.appendRecentEvent(event);

      if (shouldPersistRawEvent) {
        await this.appendRawEvent(event);
      }

      const date = this.getUtcDateString(event.timestamp);
      const currentSummary = await this.loadDailySummary(date);
      const nextSummary = this.buildDailySummaryWithEvent(event, currentSummary);

      this.summaryCache.set(date, nextSummary);
      this.dirtySummaryDates.add(date);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to append validation log: ${message}`);
    }
  }

  private shouldPersistRawEvent(event: ValidationLogEvent): boolean {
    const shouldPersist = event.isSeat === true || event.eventType === "position-opened" || event.eventType === "position-closed";

    return shouldPersist;
  }

  private enqueueWrite(eventType: string, payload: ValidationLogPayload): void {
    this.writeSequence += 1;

    const event = this.createEvent(eventType, payload);
    const previousWriteQueue = this.writeQueue;

    this.writeQueue = this.persistQueuedWrite(event, previousWriteQueue);
  }

  /**
   * @section public:methods
   */

  public logLeaderSeatInitialized(payload: ValidationLogPayload): void {
    this.enqueueWrite("leader-seat-initialized", payload);
  }

  public logLeaderWindowFinalized(payload: ValidationLogPayload): void {
    this.enqueueWrite("leader-window-finalized", payload);
  }

  public logPositionOpened(payload: ValidationLogPayload): void {
    this.enqueueWrite("position-opened", payload);
  }

  public logPositionClosed(payload: ValidationLogPayload): void {
    this.enqueueWrite("position-closed", payload);
  }

  public logValidationWarning(payload: ValidationLogPayload): void {
    this.enqueueWrite("validation-warning", payload);
  }

  public logQmonBorn(payload: ValidationLogPayload): void {
    this.enqueueWrite("qmon-born", payload);
  }

  public logQmonDied(payload: ValidationLogPayload): void {
    this.enqueueWrite("qmon-died", payload);
  }

  public logPaperOrderCreated(payload: ValidationLogPayload): void {
    this.enqueueWrite("paper-order-created", payload);
  }

  public logPaperOrderChecked(payload: ValidationLogPayload): void {
    this.enqueueWrite("paper-order-checked", payload);
  }

  public logPaperOrderFilled(payload: ValidationLogPayload): void {
    this.enqueueWrite("paper-order-filled", payload);
  }

  public logPaperOrderExpired(payload: ValidationLogPayload): void {
    this.enqueueWrite("paper-order-expired", payload);
  }

  public logPaperOrderPartialFill(payload: ValidationLogPayload): void {
    this.enqueueWrite("paper-order-partial-fill", payload);
  }

  public logLiveExecutionEvent(payload: ValidationLogPayload, eventType: string): void {
    this.enqueueWrite(eventType, payload);
  }

  public async flush(): Promise<void> {
    await this.writeQueue;
    await this.persistDirtySummaries();
  }

  public async resetCpnlState(): Promise<void> {
    await this.flush();
    this.cpnlSessionStartedAt = Date.now();
  }

  public async clearPersistedState(): Promise<void> {
    await this.flush();
    await rm(this.diagnosticsRootPath, {
      recursive: true,
      force: true,
    });
    this.recentEventCache = [];
    this.summaryCache.clear();
    this.dirtySummaryDates.clear();
    this.isRecentEventCacheHydrated = false;
    this.cpnlSessionStartedAt = Date.now();
  }

  public async readRecentEvents(limit: number): Promise<readonly ValidationLogEvent[]> {
    const recentEvents = await this.readRecentFilteredEvents(limit, () => true);

    return recentEvents;
  }

  public async readRecentCpnlEvents(limit: number): Promise<readonly ValidationLogEvent[]> {
    const recentCpnlEvents = await this.readRecentFilteredEvents(limit, (event) => {
      const hasPositionCashflow = this.isPositionCashflowEvent(event);
      const isInsideSession = this.cpnlSessionStartedAt === null || event.timestamp >= this.cpnlSessionStartedAt;

      return hasPositionCashflow && isInsideSession;
    });

    return recentCpnlEvents;
  }

  public async readCpnlLogRows(range: DiagnosticRange, limit: number): Promise<readonly CpnlLogRow[]> {
    await this.flush();
    const positionCashflowEvents = await this.readPositionCashflowEventsFromRange(range, limit);
    const cpnlLogRows = positionCashflowEvents.map((event) => this.buildCpnlLogRow(event));

    return cpnlLogRows;
  }

  public getCpnlSessionStartedAt(): number | null {
    return this.cpnlSessionStartedAt;
  }

  public async readDiagnosticsOverview(range: DiagnosticRange): Promise<DiagnosticsOverview> {
    await this.flush();
    const aggregateByRange = await this.readAggregateForRange(range);
    const globalAggregate = aggregateByRange.global;
    const marketSummaries = Object.entries(aggregateByRange.markets)
      .map(([market, aggregate]) => this.buildMarketSummary(market, aggregate))
      .sort((left, right) => {
        const seatPnlDelta = right.seatRealizedPnl - left.seatRealizedPnl;
        const fillDelta = right.fillRate - left.fillRate;
        let sortValue = seatPnlDelta;

        if (sortValue === 0) {
          sortValue = fillDelta;
        }

        return sortValue;
      });
    const totals: DiagnosticsOverview["totals"] = {
      totalEvents: globalAggregate.totalEvents,
      warningCount: Object.values(globalAggregate.warningCounts).reduce((runningCount, count) => runningCount + count, 0),
      seatRealizedPnl: globalAggregate.seatRealizedPnl,
      totalRealizedPnl: globalAggregate.totalRealizedPnl,
      fillRate: this.calculateFillRate(globalAggregate),
      paperFillRate: this.calculateFillRate(globalAggregate),
      realFillRate: this.calculateRealFillRate(globalAggregate),
      orderFailureRate: this.calculateOrderFailureRate(globalAggregate),
      avgPriceImpactBps: this.calculateAvgPriceImpactBps(globalAggregate),
      seatTradeCount: globalAggregate.seatPositionClosedCount,
    };
    const overview: DiagnosticsOverview = {
      range,
      generatedAt: Date.now(),
      totals,
      flags: [...this.buildFlags(null, globalAggregate), ...marketSummaries.flatMap((marketSummary) => marketSummary.flags)].slice(0, 12),
      markets: marketSummaries,
    };

    return overview;
  }

  public async readMarketDiagnostics(market: string, range: DiagnosticRange): Promise<DiagnosticsMarketSummary> {
    await this.flush();
    const aggregateByRange = await this.readAggregateForRange(range);
    const marketAggregate = aggregateByRange.markets[market] ?? this.createAggregateFromRange();
    const marketSummary = this.buildMarketSummary(market, marketAggregate);

    return marketSummary;
  }

  public async readDiagnosticEvents(
    market: string | undefined,
    category: DiagnosticCategory | undefined,
    range: DiagnosticRange,
    limit: number,
  ): Promise<readonly ValidationLogEvent[]> {
    await this.flush();
    const eventFilter: EventFilter = {
      range,
      limit: this.normalizeLimit(limit),
    };

    if (market !== undefined) {
      eventFilter.market = market;
    }

    if (category !== undefined) {
      eventFilter.category = category;
    }

    const diagnosticEvents = await this.readEventsFromRange({
      ...eventFilter,
    });

    return diagnosticEvents;
  }

  public async readMarketSeatEvents(market: string, range: DiagnosticRange, limit: number): Promise<readonly ValidationLogEvent[]> {
    await this.flush();
    const eventFilter: EventFilter = {
      market,
      range,
      limit: this.normalizeLimit(limit),
    };
    const rangeEvents = await this.readEventsFromRange(eventFilter);
    const marketSeatEvents = rangeEvents.filter((event) => {
      const isSeatExecutionEvent = event.category === "execution";
      const isSeatPositionEvent = event.type === "position-opened" || event.type === "position-closed";
      const isSeatWarningEvent = event.category === "warning" && typeof event.warningCode === "string" && event.warningCode.startsWith("live-");
      const isMatchingSeatEvent = event.market === market && event.isSeat === true && (isSeatPositionEvent || isSeatExecutionEvent || isSeatWarningEvent);

      return isMatchingSeatEvent;
    });

    return marketSeatEvents.slice(-eventFilter.limit);
  }
}
