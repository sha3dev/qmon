/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import type { SignalBookParser } from "./signal-book-parser.service.ts";
import type { SignalValue } from "./signal.types.ts";

/**
 * @section class
 */
export class SignalTokenPressure {
  /**
   * @section private:attributes
   */

  private readonly bookParser: SignalBookParser;

  /**
   * @section constructor
   */

  public constructor(bookParser: SignalBookParser) {
    this.bookParser = bookParser;
  }

  /**
   * @section private:methods
   */

  /**
   * Calculate imbalance for a single token's order book.
   * Returns a value in [-1, 1] or null if the book is not available.
   */
  private tokenImbalance(snap: Snapshot | undefined, bookKey: string): number | null {
    const bookJson = snap ? (snap[bookKey] ?? null) : null;
    const bba = this.bookParser.parseAndBest(typeof bookJson === "string" ? bookJson : null);

    let result: number | null = null;

    if (bba && bba.bidSize + bba.askSize > 0) {
      result = (bba.bidSize - bba.askSize) / (bba.bidSize + bba.askSize);
    }

    return result;
  }

  /**
   * @section public:methods
   */

  /**
   * Calculate relative token pressure between Up and Down order books.
   * Returns a value in [-1, 1] or null when either book is unavailable.
   */
  public calculate(snapshots: readonly Snapshot[], asset: string, window: string): SignalValue {
    const snap = snapshots[snapshots.length - 1];
    const prefix = `${asset}_${window}`;

    const upImb = this.tokenImbalance(snap, `${prefix}_up_order_book_json`);
    const downImb = this.tokenImbalance(snap, `${prefix}_down_order_book_json`);

    const result = upImb !== null && downImb !== null ? (upImb - downImb) / 2 : null;

    return result;
  }
}
