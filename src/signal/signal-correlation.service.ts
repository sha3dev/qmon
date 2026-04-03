/**
 * @section imports:internals
 */

import type {
  SignalCorrelationHistory,
  SignalCorrelationMetrics,
  SignalOutcomeSample,
} from "./signal.types.ts";

/**
 * @section consts
 */

const DEFAULT_MAX_SAMPLES = 100;
const MIN_SAMPLES_FOR_CORRELATION = 10;
const MIN_CORRELATION_THRESHOLD = 0.2;
const MAX_P_VALUE_THRESHOLD = 0.05;

/**
 * @section class
 */

/**
 * Tracks correlation between signal values and market outcomes.
 * Computes rolling correlation metrics to validate signal predictive power.
 */
export class SignalCorrelationService {
  /**
   * @section private:attributes
   */

  private correlationHistories: Map<string, SignalCorrelationHistory>;
  private readonly maxSamples: number;

  /**
   * @section constructor
   */

  public constructor(maxSamples = DEFAULT_MAX_SAMPLES) {
    this.correlationHistories = new Map();
    this.maxSamples = maxSamples;
  }

  /**
   * @section public:methods
   */

  /**
   * Record a signal-outcome pair for correlation tracking.
   */
  public recordOutcome(signalId: string, signalValue: number, outcomeValue: number, timestamp: number): void {
    if (signalValue === null || outcomeValue === null || !Number.isFinite(signalValue) || !Number.isFinite(outcomeValue)) {
      return;
    }

    let history = this.correlationHistories.get(signalId);

    if (history === undefined) {
      history = {
        signalId,
        samples: [],
        maxSamples: this.maxSamples,
      };
      this.correlationHistories.set(signalId, history);
    }

    const sample: SignalOutcomeSample = {
      signalValue,
      outcomeValue,
      timestamp,
    };

    // Maintain circular buffer
    if (history.samples.length >= history.maxSamples) {
      history.samples.shift();
    }

    history.samples.push(sample);
  }

  /**
   * Get correlation metrics for a signal.
   */
  public getCorrelationMetrics(signalId: string): SignalCorrelationMetrics | null {
    const history = this.correlationHistories.get(signalId);

    if (history === undefined || history.samples.length < MIN_SAMPLES_FOR_CORRELATION) {
      return null;
    }

    const correlation = this.computePearsonCorrelation(history.samples);
    const pValue = this.computePValue(correlation, history.samples.length);
    const isValid = Math.abs(correlation) >= MIN_CORRELATION_THRESHOLD && pValue <= MAX_P_VALUE_THRESHOLD;

    return {
      signalId,
      correlation,
      pValue,
      sampleSize: history.samples.length,
      lastUpdate: history.samples[history.samples.length - 1]?.timestamp ?? 0,
      isValid,
    };
  }

  /**
   * Get all correlation metrics.
   */
  public getAllCorrelationMetrics(): Record<string, SignalCorrelationMetrics> {
    const metrics: Record<string, SignalCorrelationMetrics> = {};

    for (const [signalId] of this.correlationHistories) {
      const metric = this.getCorrelationMetrics(signalId);
      if (metric !== null) {
        metrics[signalId] = metric;
      }
    }

    return metrics;
  }

  /**
   * Check if a signal has valid correlation (meets threshold).
   */
  public isSignalValid(signalId: string): boolean {
    const metrics = this.getCorrelationMetrics(signalId);
    return metrics !== null && metrics.isValid;
  }

  /**
   * Get correlation coefficient for a signal (null if not available).
   */
  public getSignalCorrelation(signalId: string): number | null {
    const metrics = this.getCorrelationMetrics(signalId);
    return metrics?.correlation ?? null;
  }

  /**
   * Get valid signal IDs (those meeting correlation threshold).
   */
  public getValidSignalIds(): string[] {
    const validIds: string[] = [];

    for (const [signalId] of this.correlationHistories) {
      if (this.isSignalValid(signalId)) {
        validIds.push(signalId);
      }
    }

    return validIds;
  }

  /**
   * Clear all correlation history.
   */
  public clear(): void {
    this.correlationHistories.clear();
  }

  /**
   * @section private:methods
   */

  /**
   * Compute Pearson correlation coefficient.
   */
  private computePearsonCorrelation(samples: readonly SignalOutcomeSample[]): number {
    const n = samples.length;
    if (n < 2) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    let sumY2 = 0;

    for (const sample of samples) {
      sumX += sample.signalValue;
      sumY += sample.outcomeValue;
      sumXY += sample.signalValue * sample.outcomeValue;
      sumX2 += sample.signalValue * sample.signalValue;
      sumY2 += sample.outcomeValue * sample.outcomeValue;
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) {
      return 0;
    }

    return numerator / denominator;
  }

  /**
   * Compute two-tailed p-value for correlation coefficient.
   * Uses t-test with n-2 degrees of freedom.
   */
  private computePValue(correlation: number, sampleSize: number): number {
    if (sampleSize < 3) {
      return 1;
    }

    const absCorrelation = Math.abs(correlation);

    if (absCorrelation >= 1) {
      return 0;
    }

    const degreesOfFreedom = sampleSize - 2;
    const tStatistic = absCorrelation / Math.sqrt(1 - absCorrelation * absCorrelation);
    const tSquared = tStatistic * tStatistic;

    // Approximate p-value using t-distribution
    // This is a simplified calculation - for production use a proper statistical library
    const pValue = 2 * (1 - this.studentTCDF(tStatistic, degreesOfFreedom));

    return Math.max(0, Math.min(1, pValue));
  }

  /**
   * Approximate Student's t cumulative distribution function.
   * Uses a simplified approximation - adequate for correlation validation.
   */
  private studentTCDF(t: number, degreesOfFreedom: number): number {
    const absT = Math.abs(t);
    const df = degreesOfFreedom;

    // For large degrees of freedom, approximate with normal distribution
    if (df > 100) {
      return this.normalCDF(absT);
    }

    // Simplified approximation for t-distribution CDF
    // This is conservative (slightly underestimates confidence)
    const a = df / (df + t * t);
    const probability = 1 - 0.5 * Math.pow(a, 0.5 * df);

    return probability;
  }

  /**
   * Standard normal cumulative distribution function.
   */
  private normalCDF(z: number): number {
    // Abramowitz and Stegun approximation 7.1.26
    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.sqrt(2);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const erf = 1 - (((((a5 * z + a4) * z) + a3) * z + a2) * z + a1) * z * Math.exp(-z * z);

    return 0.5 * (1 + sign * erf);
  }
}
