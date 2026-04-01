/**
 * @section imports:internals
 */

import type { BestBidAsk, BookLevel, ParsedBook } from "./signal.types.ts";

/**
 * @section consts
 */

const MAX_BOOK_PARSE_CACHE_SIZE = 512;

/**
 * @section class
 */
export class SignalBookParser {
  /**
   * @section private:attributes
   */

  private readonly parsedBookCache: Map<string, ParsedBook | null>;
  private readonly bestBidAskCache: Map<string, BestBidAsk | null>;

  /**
   * @section constructor
   */

  public constructor() {
    this.parsedBookCache = new Map();
    this.bestBidAskCache = new Map();
  }

  /**
   * @section private:methods
   */

  /**
   * Store one cached value and evict the oldest entry when the cache is full.
   */
  private setCachedValue<TValue>(cache: Map<string, TValue>, key: string, cachedValue: TValue): void {
    cache.set(key, cachedValue);

    if (cache.size > MAX_BOOK_PARSE_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;

      if (typeof oldestKey === "string") {
        cache.delete(oldestKey);
      }
    }
  }

  /**
   * Safely parse an order book JSON string, returning null on any failure.
   * Filters out levels with non-finite price or size values.
   */
  private safeParse(orderBookJson: string | null): ParsedBook | null {
    let result: ParsedBook | null = null;

    if (typeof orderBookJson === "string" && orderBookJson.length > 0) {
      try {
        const raw = JSON.parse(orderBookJson) as { bids?: unknown[]; asks?: unknown[] };
        const bids = this.parseLevels(raw.bids);
        const asks = this.parseLevels(raw.asks);

        if (bids.length > 0 || asks.length > 0) {
          result = { bids, asks };
        }
      } catch (parseError: unknown) {
        /** Malformed JSON is expected for stale or missing order book fields */
        console.warn("SignalBookParser: malformed order book JSON", parseError);
        result = null;
      }
    }

    return result;
  }

  /**
   * Parse an array of raw levels into typed BookLevel entries.
   * Filters out entries with non-finite price or size.
   */
  private parseLevels(raw: unknown[] | undefined): readonly BookLevel[] {
    const levels: BookLevel[] = [];

    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const entry = raw[i] as { price?: unknown; size?: unknown } | undefined;
        if (entry) {
          const price = Number(entry.price);
          const size = Number(entry.size);
          if (Number.isFinite(price) && Number.isFinite(size) && size > 0) {
            levels.push({ price, size });
          }
        }
      }
    }

    return levels;
  }

  /**
   * Find the best bid (highest price) and best ask (lowest price)
   * via single-pass linear scan. Returns null if either side is empty.
   */
  private extractBestBidAsk(book: ParsedBook | null): BestBidAsk | null {
    let result: BestBidAsk | null = null;

    const firstBid = book ? book.bids[0] : undefined;
    const firstAsk = book ? book.asks[0] : undefined;

    if (book && firstBid && firstAsk) {
      let bestBid = firstBid;
      for (let i = 1; i < book.bids.length; i++) {
        const bid = book.bids[i];
        if (bid && bid.price > bestBid.price) {
          bestBid = bid;
        }
      }

      let bestAsk = firstAsk;
      for (let i = 1; i < book.asks.length; i++) {
        const ask = book.asks[i];
        if (ask && ask.price < bestAsk.price) {
          bestAsk = ask;
        }
      }

      const mid = (bestBid.price + bestAsk.price) / 2;
      result = {
        bidPrice: bestBid.price,
        bidSize: bestBid.size,
        askPrice: bestAsk.price,
        askSize: bestAsk.size,
        mid,
        spread: bestAsk.price - bestBid.price,
      };
    }

    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Parse a raw order book JSON string into a typed {@link ParsedBook}.
   * Returns null when the input is null, malformed, or contains no valid levels.
   *
   * Performance: single-pass parse + filter. No intermediate sorts since
   * bestBidAsk scans linearly for min/max.
   */
  public parse(orderBookJson: string | null): ParsedBook | null {
    let result: ParsedBook | null = null;

    if (typeof orderBookJson === "string" && orderBookJson.length > 0) {
      const cachedParsedBook = this.parsedBookCache.get(orderBookJson);

      if (cachedParsedBook !== undefined) {
        result = cachedParsedBook;
      } else {
        result = this.safeParse(orderBookJson);
        this.setCachedValue(this.parsedBookCache, orderBookJson, result);
      }
    } else {
      result = this.safeParse(orderBookJson);
    }

    return result;
  }

  /**
   * Extract the best bid and best ask from a parsed order book.
   * Returns null when either side is empty (no valid quote).
   *
   * The best bid is the highest-priced bid; the best ask is the lowest-priced ask.
   * Mid-price is the arithmetic mean of best bid and best ask prices.
   */
  public bestBidAsk(book: ParsedBook | null): BestBidAsk | null {
    const result = this.extractBestBidAsk(book);
    return result;
  }

  /**
   * Convenience: parse JSON and immediately extract best bid/ask in one call.
   */
  public parseAndBest(orderBookJson: string | null): BestBidAsk | null {
    let result: BestBidAsk | null = null;

    if (typeof orderBookJson === "string" && orderBookJson.length > 0) {
      const cachedBestBidAsk = this.bestBidAskCache.get(orderBookJson);

      if (cachedBestBidAsk !== undefined) {
        result = cachedBestBidAsk;
      } else {
        const parsed = this.parse(orderBookJson);
        result = this.bestBidAsk(parsed);
        this.setCachedValue(this.bestBidAskCache, orderBookJson, result);
      }
    } else {
      const parsed = this.parse(orderBookJson);
      result = this.bestBidAsk(parsed);
    }

    return result;
  }
}
