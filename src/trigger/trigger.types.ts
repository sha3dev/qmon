/**
 * @section types
 */

/** Severity levels for trigger events, ordered by urgency. */
export type TriggerSeverity = "info" | "warning" | "critical";

/**
 * A trigger event fired when a specific market condition is detected.
 * Asset-level triggers have window set to null.
 */
export type TriggerEvent = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly severity: TriggerSeverity;
  readonly asset: string;
  readonly window: string | null;
  readonly firedAt: number;
};
