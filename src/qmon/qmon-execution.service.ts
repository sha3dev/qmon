/**
 * @section imports:internals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

import config from "../config.ts";
import { SignalBookParser } from "../signal/signal-book-parser.service.ts";
import type { BestBidAsk, ParsedBook } from "../signal/signal.types.ts";
import type {
  DirectionRegimeValue,
  DominantSignalGroup,
  MarketKey,
  PendingOrderAction,
  QmonPendingOrder,
  TradeabilityAssessment,
  TradingAction,
  VolatilityRegimeValue,
} from "./qmon.types.ts";

/**
 * @section consts
 */

const MIN_POSITION_SHARES = 5;
const MIN_POSITION_NOTIONAL_USD = 1;
const POLYMARKET_CRYPTO_TAKER_FEE_RATE = 0.072;
const POLYMARKET_CRYPTO_TAKER_FEE_EXPONENT = 1;
const PAPER_ORDER_FULL_FILL_CHECK_DELAY_MS = 1_500;
const PAPER_ORDER_PARTIAL_FILL_CHECK_DELAY_MS = 4_000;
const PAPER_ORDER_NO_FILL_CHECK_DELAY_MS = 9_000;
const PAPER_ORDER_PARTIAL_FILL_TIMEOUT_MS = 9_000;
const PAPER_ORDER_NO_FILL_TIMEOUT_MS = 15_000;

/**
 * @section types
 */

export type QmonFillResult = {
  readonly filledShares: number;
  readonly remainingShares: number;
  readonly averagePrice: number | null;
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly consumedLevelsJson: string | null;
  readonly consumedLevelCount: number;
  readonly worstPrice: number | null;
};

/**
 * @section class
 */

export class QmonExecutionService {
  /**
   * @section private:attributes
   */

  private readonly bookParser: SignalBookParser;

  /**
   * @section constructor
   */

  public constructor(bookParser?: SignalBookParser) {
    this.bookParser = bookParser ?? new SignalBookParser();
  }

  /**
   * @section public:methods
   */

  /**
   * Resolve the parsed book for the traded token side.
   */
  public getTokenBook(asset: string, window: string, action: PendingOrderAction | TradingAction, snapshots: readonly Snapshot[]): ParsedBook | null {
    const latestSnapshot = this.getLatestSnapshot(snapshots);
    const tokenSide = this.getTokenSide(action);
    let tokenBook: ParsedBook | null = null;

    if (latestSnapshot !== null && tokenSide !== null) {
      const orderBookKey = `${asset}_${window}_${tokenSide}_order_book_json`;
      const orderBookJson = latestSnapshot[orderBookKey] ?? null;

      if (typeof orderBookJson === "string") {
        tokenBook = this.bookParser.parse(orderBookJson);
      }
    }

    return tokenBook;
  }

  /**
   * Read the current best bid/ask from a parsed book.
   */
  public getBookBestBidAsk(tokenBook: ParsedBook | null): BestBidAsk | null {
    const bestBidAsk = this.bookParser.bestBidAsk(tokenBook);

    return bestBidAsk;
  }

  /**
   * Simulate immediate taker execution against visible depth.
   */
  public simulateFill(tokenBook: ParsedBook | null, pendingOrder: QmonPendingOrder): QmonFillResult {
    const bestBidAsk = this.getBookBestBidAsk(tokenBook);
    let fillResult: QmonFillResult = {
      filledShares: 0,
      remainingShares: pendingOrder.remainingShares,
      averagePrice: null,
      bestBid: bestBidAsk?.bidPrice ?? null,
      bestAsk: bestBidAsk?.askPrice ?? null,
      consumedLevelsJson: null,
      consumedLevelCount: 0,
      worstPrice: null,
    };

    if (tokenBook !== null) {
      if (pendingOrder.action === "BUY_UP" || pendingOrder.action === "BUY_DOWN") {
        const buyFill = this.walkBookLevels(tokenBook.asks, pendingOrder.remainingShares);
        fillResult = {
          ...buyFill,
          bestBid: bestBidAsk?.bidPrice ?? null,
          bestAsk: bestBidAsk?.askPrice ?? null,
        };
      } else {
        const sellFill = this.walkBookLevels(tokenBook.bids, pendingOrder.remainingShares);
        fillResult = {
          ...sellFill,
          bestBid: bestBidAsk?.bidPrice ?? null,
          bestAsk: bestBidAsk?.askPrice ?? null,
        };
      }
    }

    return fillResult;
  }

  /**
   * Compute the minimum valid share count for a displayed token price.
   */
  public computeShareCount(tokenPrice: number | null): number | null {
    let shareCount: number | null = null;

    if (tokenPrice !== null && tokenPrice > 0 && tokenPrice <= 1) {
      const minimumNotionalShares = Math.ceil(MIN_POSITION_NOTIONAL_USD / tokenPrice);
      if (config.QMON_USE_MINIMUM_ENTRY_SHARES) {
        const minimumNetShares = Math.max(MIN_POSITION_SHARES, minimumNotionalShares);
        const takerBuyFeeShareRate = this.calculateTakerBuyFeeShareRate(tokenPrice);
        shareCount = Math.ceil(minimumNetShares / Math.max(1 - takerBuyFeeShareRate, Number.EPSILON));
      } else {
        let candidateShareCount = 1;
        let hasReachedMinimumNotional = false;

        while (!hasReachedMinimumNotional) {
          const candidateNetShares = this.calculateNetTakerBuyShares(candidateShareCount, tokenPrice);
          hasReachedMinimumNotional = candidateNetShares * tokenPrice >= MIN_POSITION_NOTIONAL_USD;

          if (!hasReachedMinimumNotional) {
            candidateShareCount += 1;
          }
        }

        shareCount = candidateShareCount;
      }
    }

    return shareCount;
  }

  /**
   * Compute share count based on signal strength (score).
   * Stronger signals get larger position sizes (up to a maximum multiplier).
   *
   * @param tokenPrice - The token price to compute base shares
   * @param score - The current signal score (absolute value)
   * @param threshold - The threshold that was crossed to generate the signal
   * @param maxMultiplier - Maximum position size multiplier (default 3x)
   * @returns Share count adjusted for signal strength, or null if invalid
   */
  public computeShareCountWithScore(tokenPrice: number | null, score: number, threshold: number, maxMultiplier = 3): number | null {
    const baseShareCount = this.computeShareCount(tokenPrice);
    if (baseShareCount === null) {
      return null;
    }

    // Calculate how far above threshold the score is (strength factor)
    // Example: score=0.8, threshold=0.4 → strength = 1.0 (at threshold)
    //          score=0.6, threshold=0.4 → strength = 0.5 (50% above threshold)
    const scoreStrength = Math.max(0, Math.abs(score) - threshold) / threshold;

    // Apply multiplier based on strength (capped at maxMultiplier)
    // Uses a gentle curve: multiplier = 1 + strength * (maxMultiplier - 1)
    const multiplier = 1 + Math.min(scoreStrength, maxMultiplier - 1);

    return Math.ceil(baseShareCount * multiplier);
  }

  /**
   * Calculate the Polymarket taker fee in USDC-equivalent for one matched quantity.
   */
  public calculateTakerFeeUsd(shareCount: number, tokenPrice: number | null): number {
    let takerFeeUsd = 0;

    if (tokenPrice !== null && tokenPrice > 0 && shareCount > 0) {
      const feeWeight = tokenPrice * (1 - tokenPrice);
      takerFeeUsd = shareCount * tokenPrice * POLYMARKET_CRYPTO_TAKER_FEE_RATE * feeWeight ** POLYMARKET_CRYPTO_TAKER_FEE_EXPONENT;
    }

    return takerFeeUsd;
  }

  /**
   * Convert the buy-side taker fee from USDC-equivalent into deducted shares.
   */
  public calculateTakerBuyFeeShares(shareCount: number, tokenPrice: number | null): number {
    let takerBuyFeeShares = 0;

    if (tokenPrice !== null && tokenPrice > 0 && shareCount > 0) {
      takerBuyFeeShares = this.calculateTakerFeeUsd(shareCount, tokenPrice) / tokenPrice;
    }

    return takerBuyFeeShares;
  }

  /**
   * Compute the net shares actually received after a taker buy fee is deducted in shares.
   */
  public calculateNetTakerBuyShares(shareCount: number, tokenPrice: number | null): number {
    const takerBuyFeeShares = this.calculateTakerBuyFeeShares(shareCount, tokenPrice);
    const netTakerBuyShares = Math.max(0, shareCount - takerBuyFeeShares);

    return netTakerBuyShares;
  }

  /**
   * Recover the entry-side taker fee from a held net share count.
   */
  public calculateHeldEntryTakerFeeUsd(netShareCount: number, tokenPrice: number | null): number {
    let heldEntryTakerFeeUsd = 0;

    if (tokenPrice !== null && tokenPrice > 0 && netShareCount > 0) {
      const takerBuyFeeShareRate = this.calculateTakerBuyFeeShareRate(tokenPrice);
      const grossShareCount = netShareCount / Math.max(1 - takerBuyFeeShareRate, Number.EPSILON);

      heldEntryTakerFeeUsd = this.calculateTakerFeeUsd(grossShareCount, tokenPrice);
    }

    return heldEntryTakerFeeUsd;
  }

  /**
   * Measure price impact in basis points relative to the best visible quote.
   */
  public calculatePriceImpactBps(referencePrice: number | null, averagePrice: number | null, action: PendingOrderAction): number | null {
    let priceImpactBps: number | null = null;

    if (referencePrice !== null && averagePrice !== null && referencePrice > 0) {
      const rawImpact = ((averagePrice - referencePrice) / referencePrice) * 10_000;
      priceImpactBps = action === "BUY_UP" || action === "BUY_DOWN" ? rawImpact : -rawImpact;
    }

    return priceImpactBps;
  }

  /**
   * Reject fills when measured slippage is above the configured genome budget.
   */
  public shouldRejectFillForSlippage(maxSlippageBps: number, pendingOrder: QmonPendingOrder, fillResult: QmonFillResult): number | null {
    let rejectedSlippageBps: number | null = null;

    if (fillResult.averagePrice !== null) {
      const referencePrice = pendingOrder.action === "BUY_UP" || pendingOrder.action === "BUY_DOWN" ? fillResult.bestAsk : fillResult.bestBid;
      const measuredSlippageBps = this.calculatePriceImpactBps(referencePrice, fillResult.averagePrice, pendingOrder.action);

      if (measuredSlippageBps !== null && measuredSlippageBps > maxSlippageBps) {
        rejectedSlippageBps = measuredSlippageBps;
      }
    }

    return rejectedSlippageBps;
  }

  /**
   * Validate whether an entry fill still produces a tradable position.
   */
  public isEntryFillValid(fillResult: QmonFillResult): boolean {
    const filledShares = this.calculateNetTakerBuyShares(fillResult.filledShares, fillResult.averagePrice);
    const averagePrice = fillResult.averagePrice;
    let isValid = false;

    if (averagePrice !== null) {
      const notional = filledShares * averagePrice;
      const hasValidShareCount = config.QMON_USE_MINIMUM_ENTRY_SHARES ? filledShares >= MIN_POSITION_SHARES : filledShares > 0;
      isValid = hasValidShareCount && notional >= MIN_POSITION_NOTIONAL_USD;
    }

    return isValid;
  }

  /**
   * Create a pending taker order.
   */
  public createPendingOrder(
    kind: "entry" | "exit",
    action: PendingOrderAction,
    score: number,
    triggeredBy: readonly string[],
    requestedShares: number,
    limitPrice: number,
    market: MarketKey,
    marketStartMs: number | null,
    marketEndMs: number | null,
    priceToBeat: number | null,
    timestamp: number,
    tradeabilityAssessment?: TradeabilityAssessment,
    entryDirectionRegime: DirectionRegimeValue | null = null,
    entryVolatilityRegime: VolatilityRegimeValue | null = null,
  ): QmonPendingOrder {
    const pendingOrder: QmonPendingOrder = {
      kind,
      action,
      score,
      triggeredBy,
      requestedShares,
      remainingShares: requestedShares,
      limitPrice,
      createdAt: timestamp,
      market,
      marketStartMs,
      marketEndMs,
      priceToBeat,
      entryDirectionRegime,
      entryVolatilityRegime,
      directionalAlpha: tradeabilityAssessment?.directionalAlpha ?? 0,
      finalOutcomeProbability: tradeabilityAssessment?.finalOutcomeProbability ?? 0,
      marketImpliedProbability: tradeabilityAssessment?.marketImpliedProbability ?? limitPrice,
      estimatedEdgeBps: tradeabilityAssessment?.estimatedEdgeBps ?? 0,
      estimatedNetEvUsd: tradeabilityAssessment?.estimatedNetEvUsd ?? 0,
      predictedSlippageBps: tradeabilityAssessment?.predictedSlippageBps ?? 0,
      predictedFillQuality: tradeabilityAssessment?.predictedFillQuality ?? 0,
      riskBudgetUsd: tradeabilityAssessment?.riskBudgetUsd ?? 0,
      signalAgreementCount: tradeabilityAssessment?.signalAgreementCount ?? 0,
      dominantSignalGroup: tradeabilityAssessment?.dominantSignalGroup ?? ("none" as DominantSignalGroup),
      tradeabilityRejectReason: tradeabilityAssessment?.tradeabilityRejectReason ?? null,
    };

    return pendingOrder;
  }

  /**
   * Check whether a pending order has reached the end of its market.
   */
  public hasPendingOrderExpiredAtMarketEnd(pendingOrder: QmonPendingOrder, timestamp: number): boolean {
    let hasExpired = false;

    if (pendingOrder.marketEndMs !== null) {
      hasExpired = timestamp >= pendingOrder.marketEndMs;
    }

    return hasExpired;
  }

  /**
   * Taker orders are always ready for processing.
   */
  public canCheckPendingOrder(): boolean {
    return true;
  }

  /**
   * Paper entries should only confirm when the visible book can satisfy the
   * whole request, matching the real FOK-like entry behavior more closely.
   */
  public shouldRequireFullFill(pendingOrder: QmonPendingOrder): boolean {
    let shouldRequire = false;

    if (pendingOrder.kind === "entry") {
      shouldRequire = true;
    }

    return shouldRequire;
  }

  /**
   * Delay paper order checks based on visible book executability.
   */
  public hasPendingOrderReachedCheckTime(pendingOrder: QmonPendingOrder, fillResult: QmonFillResult, timestamp: number): boolean {
    const orderAgeMs = timestamp - pendingOrder.createdAt;
    const checkDelayMs = this.getPaperOrderCheckDelayMs(pendingOrder, fillResult);
    let hasReachedCheckTime = false;

    if (timestamp > pendingOrder.createdAt && orderAgeMs >= checkDelayMs) {
      hasReachedCheckTime = true;
    }

    return hasReachedCheckTime;
  }

  /**
   * Give the visible book some time to improve before treating a paper order
   * as rejected.
   */
  public hasPendingOrderTimedOut(pendingOrder: QmonPendingOrder, fillResult: QmonFillResult, timestamp: number): boolean {
    const orderAgeMs = timestamp - pendingOrder.createdAt;
    const timeoutMs = this.getPaperOrderTimeoutMs(pendingOrder, fillResult);
    let hasTimedOut = false;

    if (orderAgeMs >= timeoutMs) {
      hasTimedOut = true;
    }

    return hasTimedOut;
  }

  /**
   * @section private:methods
   */

  /**
   * Resolve the latest snapshot from the current batch.
   */
  private getLatestSnapshot(snapshots: readonly Snapshot[]): Snapshot | null {
    const latestSnapshot = snapshots[snapshots.length - 1] ?? null;

    return latestSnapshot;
  }

  /**
   * Resolve the token side used by the traded action.
   */
  private getTokenSide(action: PendingOrderAction | TradingAction): "up" | "down" | null {
    let tokenSide: "up" | "down" | null = null;

    if (action === "BUY_UP" || action === "SELL_UP") {
      tokenSide = "up";
    } else if (action === "BUY_DOWN" || action === "SELL_DOWN") {
      tokenSide = "down";
    }

    return tokenSide;
  }

  /**
   * Walk the requested book side and compute VWAP plus residual size.
   */
  private walkBookLevels(levels: readonly { readonly price: number; readonly size: number }[], requestedShares: number): QmonFillResult {
    let remainingShares = requestedShares;
    let filledShares = 0;
    let notional = 0;
    const consumedLevels: string[] = [];
    let worstPrice: number | null = null;

    for (const level of levels) {
      const fillShares = Math.min(level.size, remainingShares);

      if (fillShares <= 0) {
        continue;
      }

      filledShares += fillShares;
      remainingShares -= fillShares;
      notional += fillShares * level.price;
      worstPrice = level.price;
      consumedLevels.push(`${level.price.toFixed(6)}x${fillShares.toFixed(4)}`);

      if (remainingShares === 0) {
        break;
      }
    }

    const fillResult: QmonFillResult = {
      filledShares,
      remainingShares,
      averagePrice: filledShares > 0 ? notional / filledShares : null,
      bestBid: null,
      bestAsk: null,
      consumedLevelsJson: consumedLevels.length > 0 ? consumedLevels.join("|") : null,
      consumedLevelCount: consumedLevels.length,
      worstPrice,
    };

    return fillResult;
  }

  /**
   * Calculate the buy-side taker fee as a share-rate multiplier.
   */
  private calculateTakerBuyFeeShareRate(tokenPrice: number): number {
    const feeWeight = tokenPrice * (1 - tokenPrice);
    const takerBuyFeeShareRate = POLYMARKET_CRYPTO_TAKER_FEE_RATE * feeWeight ** POLYMARKET_CRYPTO_TAKER_FEE_EXPONENT;

    return takerBuyFeeShareRate;
  }

  /**
   * Convert visible book depth into a crude wait time proxy. When the whole
   * order is visible we fill quickly; when only part of it is visible we wait
   * longer before giving up; and with zero visible fill we wait the longest.
   */
  private getPaperOrderCheckDelayMs(pendingOrder: QmonPendingOrder, fillResult: QmonFillResult): number {
    const visibleFillRatio = this.getVisibleFillRatio(pendingOrder, fillResult);
    let checkDelayMs = PAPER_ORDER_NO_FILL_CHECK_DELAY_MS;

    if (visibleFillRatio >= 1) {
      checkDelayMs = PAPER_ORDER_FULL_FILL_CHECK_DELAY_MS;
    } else if (visibleFillRatio > 0) {
      checkDelayMs = PAPER_ORDER_PARTIAL_FILL_CHECK_DELAY_MS;
    }

    return checkDelayMs;
  }

  /**
   * Timeouts are also derived from current visible fill quality so paper does
   * not reject immediately when the book is merely thin for a moment.
   */
  private getPaperOrderTimeoutMs(pendingOrder: QmonPendingOrder, fillResult: QmonFillResult): number {
    const visibleFillRatio = this.getVisibleFillRatio(pendingOrder, fillResult);
    let timeoutMs = PAPER_ORDER_NO_FILL_TIMEOUT_MS;

    if (visibleFillRatio > 0 && visibleFillRatio < 1) {
      timeoutMs = PAPER_ORDER_PARTIAL_FILL_TIMEOUT_MS;
    } else if (visibleFillRatio >= 1) {
      timeoutMs = this.getPaperOrderCheckDelayMs(pendingOrder, fillResult);
    }

    return timeoutMs;
  }

  /**
   * Visible fill ratio is the simplest book-derived proxy for whether the
   * order is realistically executable right now.
   */
  private getVisibleFillRatio(pendingOrder: QmonPendingOrder, fillResult: QmonFillResult): number {
    const requestedShares = Math.max(pendingOrder.remainingShares, Number.EPSILON);
    const visibleFillRatio = fillResult.filledShares / requestedShares;

    return visibleFillRatio;
  }
}
