/**
 * @section types
 */

export type QmonRole = "champion" | "candidate";

export type QmonLifecycle = "active" | "retired";

export type QmonId = string;

export type MarketKey = `${string}-${string}`;

export type HorizonLabel = "30s" | "2m" | "5m";

export type TriggerGene = {
  readonly triggerId: string;
  readonly isEnabled: boolean;
};

export type SignalWeights = Readonly<Partial<Record<HorizonLabel | "_default", number>>>;

export type SignalGene = {
  readonly signalId: string;
  readonly weights: SignalWeights;
};

export type TimeWindowGenes = readonly [boolean, boolean, boolean];

export type DirectionRegimeGenes = readonly [boolean, boolean, boolean];

export type VolatilityRegimeGenes = readonly [boolean, boolean, boolean];

export type PredictiveSignalId = "edge" | "distance" | "momentum" | "velocity" | "meanReversion" | "crossAssetMomentum";

export type MicrostructureSignalId = "imbalance" | "microprice" | "bookDepth" | "spread" | "staleness" | "tokenPressure";

export type QmonSignalId = PredictiveSignalId | MicrostructureSignalId;

export type SignalOrientation = "aligned" | "inverse";

export type SignalWeightTier = 1 | 2 | 3;

export type PredictiveSignalGene = {
  readonly signalId: PredictiveSignalId;
  readonly orientation: SignalOrientation;
  readonly weightTier: SignalWeightTier;
};

export type MicrostructureSignalGene = {
  readonly signalId: MicrostructureSignalId;
  readonly orientation: SignalOrientation;
  readonly weightTier: SignalWeightTier;
};

export type EntryPolicy = {
  readonly minEdgeBps: number;
  readonly minNetEvUsd: number;
  readonly minConfirmations: number;
  readonly maxSpreadPenaltyBps: number;
  readonly maxSlippageBps: number;
  readonly minFillQuality: number;
};

export type ExecutionSizeTier = 1 | 2 | 3;

export type CooldownProfile = "tight" | "balanced" | "patient";

export type ExecutionPolicy = {
  readonly sizeTier: ExecutionSizeTier;
  readonly maxTradesPerWindow: number;
  readonly cooldownProfile: CooldownProfile;
};

export type ThesisInvalidationPolicy = "alpha-flip" | "microstructure-failure" | "hybrid";

export type ExitPolicy = {
  readonly extremeStopLossPct: number;
  readonly extremeTakeProfitPct: number;
  readonly thesisInvalidationPolicy: ThesisInvalidationPolicy;
};

export type QmonGenome = {
  readonly predictiveSignalGenes: readonly PredictiveSignalGene[];
  readonly microstructureSignalGenes: readonly MicrostructureSignalGene[];
  readonly signalGenes: readonly SignalGene[];
  readonly triggerGenes: readonly TriggerGene[];
  readonly timeWindowGenes: TimeWindowGenes;
  readonly directionRegimeGenes: DirectionRegimeGenes;
  readonly volatilityRegimeGenes: VolatilityRegimeGenes;
  readonly exchangeWeights: ExchangeWeights;
  readonly entryPolicy: EntryPolicy;
  readonly executionPolicy: ExecutionPolicy;
  readonly exitPolicy: ExitPolicy;
  readonly maxTradesPerWindow: number;
  readonly maxSlippageBps: number;
  readonly minScoreBuy: number;
  readonly minScoreSell: number;
  readonly stopLossPct: number;
  readonly takeProfitPct: number;
};

export type TradingAction = "BUY_UP" | "BUY_DOWN" | "HOLD";

export type PendingOrderAction = "BUY_UP" | "BUY_DOWN" | "SELL_UP" | "SELL_DOWN";

export type PendingOrderKind = "entry" | "exit";

export type DominantSignalGroup = "predictive" | "microstructure" | "mixed" | "none";

export type QmonExecutionRoute = "paper" | "real";

export type QmonExecutionState =
  | "paper"
  | "real-armed"
  | "real-pending-entry"
  | "real-open"
  | "real-pending-exit"
  | "real-error"
  | "real-halted"
  | "real-recovery-required";

export type TradeabilityAssessment = {
  readonly directionalAlpha: number;
  readonly estimatedEdgeBps: number;
  readonly estimatedNetEvUsd: number;
  readonly predictedSlippageBps: number;
  readonly predictedFillQuality: number;
  readonly signalAgreementCount: number;
  readonly dominantSignalGroup: DominantSignalGroup;
  readonly tradeabilityRejectReason: string | null;
  readonly shouldAllowEntry: boolean;
};

export type QmonPendingOrder = {
  readonly kind: PendingOrderKind;
  readonly action: PendingOrderAction;
  readonly score: number;
  readonly triggeredBy: readonly string[];
  readonly requestedShares: number;
  readonly remainingShares: number;
  readonly limitPrice: number;
  readonly createdAt: number;
  readonly market: MarketKey;
  readonly marketStartMs: number | null;
  readonly marketEndMs: number | null;
  readonly priceToBeat: number | null;
  readonly entryDirectionRegime?: DirectionRegimeValue | null;
  readonly entryVolatilityRegime?: VolatilityRegimeValue | null;
  readonly directionalAlpha?: number;
  readonly estimatedEdgeBps?: number;
  readonly estimatedNetEvUsd?: number;
  readonly predictedSlippageBps?: number;
  readonly predictedFillQuality?: number;
  readonly signalAgreementCount?: number;
  readonly dominantSignalGroup?: DominantSignalGroup;
  readonly tradeabilityRejectReason?: string | null;
};

export type QmonPosition = {
  readonly action: TradingAction | null;
  readonly enteredAt: number | null;
  readonly entryScore: number | null;
  readonly entryPrice: number | null;
  readonly peakReturnPct: number | null;
  readonly shareCount: number | null;
  readonly priceToBeat: number | null;
  readonly marketStartMs: number | null;
  readonly marketEndMs: number | null;
  readonly entryTriggers?: readonly string[];
  readonly entryDirectionRegime?: DirectionRegimeValue | null;
  readonly entryVolatilityRegime?: VolatilityRegimeValue | null;
  readonly directionalAlpha?: number | null;
  readonly estimatedEdgeBps?: number | null;
  readonly estimatedNetEvUsd?: number | null;
  readonly predictedSlippageBps?: number | null;
  readonly predictedFillQuality?: number | null;
  readonly signalAgreementCount?: number | null;
  readonly dominantSignalGroup?: DominantSignalGroup;
};

export type QmonConfirmedVenueSeat = {
  readonly action: TradingAction;
  readonly shareCount: number;
  readonly entryPrice: number | null;
  readonly enteredAt: number;
};

export type QmonPendingVenueOrderSnapshot = {
  readonly orderId: string;
  readonly marketSlug: string | null;
  readonly side: "buy" | "sell" | null;
  readonly outcome: "up" | "down" | null;
  readonly size: number | null;
  readonly price: number | null;
  readonly status: string | null;
  readonly createdAt: number | null;
};

export type QmonDecision = {
  readonly timestamp: number;
  readonly market: MarketKey;
  readonly action: TradingAction;
  readonly cashflow: number;
  readonly modelScore: number | null;
  readonly triggeredBy: readonly string[];
  readonly fee: number;
  readonly executionPrice: number | null;
  readonly entryPrice: number | null;
  readonly shareCount: number | null;
  readonly priceImpactBps: number | null;
  readonly isHydratedReplay: boolean;
  readonly entryDirectionRegime?: DirectionRegimeValue | null;
  readonly entryVolatilityRegime?: VolatilityRegimeValue | null;
  readonly directionalAlpha?: number | null;
  readonly estimatedEdgeBps?: number | null;
  readonly estimatedNetEvUsd?: number | null;
  readonly predictedSlippageBps?: number | null;
  readonly tradeabilityRejectReason?: string | null;
  readonly signalAgreementCount?: number | null;
  readonly dominantSignalGroup?: DominantSignalGroup;
};

export type RegimePerformanceSlice = {
  readonly regime: string;
  readonly tradeCount: number;
  readonly totalPnl: number;
  readonly estimatedNetEvUsd: number;
};

export type TriggerPerformanceSlice = {
  readonly triggerId: string;
  readonly tradeCount: number;
  readonly totalPnl: number;
  readonly estimatedNetEvUsd: number;
};

export type QmonMetrics = {
  readonly totalTrades: number;
  readonly totalPnl: number;
  readonly peakTotalPnl?: number;
  readonly championScore: number | null;
  readonly fitnessScore?: number | null;
  readonly paperWindowMedianPnl: number | null;
  readonly paperWindowPnlSum: number;
  readonly paperLongWindowPnlSum: number;
  readonly negativeWindowRateLast10: number;
  readonly worstWindowPnlLast10: number | null;
  readonly recentAvgSlippageBps: number;
  readonly isChampionEligible: boolean;
  readonly championEligibilityReasons: readonly string[];
  readonly totalFeesPaid: number;
  readonly winRate: number;
  readonly winCount: number;
  readonly avgScore: number;
  readonly maxDrawdown: number;
  readonly grossAlphaCapture?: number;
  readonly netPnlPerTrade?: number;
  readonly feeRatio?: number;
  readonly slippageRatio?: number;
  readonly noTradeDisciplineScore?: number;
  readonly regimeBreakdown?: readonly RegimePerformanceSlice[];
  readonly triggerBreakdown?: readonly TriggerPerformanceSlice[];
  readonly totalEstimatedNetEvUsd?: number;
  readonly lastUpdate: number;
};

export type Qmon = {
  readonly id: QmonId;
  readonly market: MarketKey;
  readonly genome: QmonGenome;
  readonly role: QmonRole;
  readonly lifecycle: QmonLifecycle;
  readonly generation: number;
  readonly parentIds: readonly QmonId[];
  readonly createdAt: number;
  readonly position: QmonPosition;
  readonly pendingOrder: QmonPendingOrder | null;
  readonly metrics: QmonMetrics;
  readonly decisionHistory: readonly QmonDecision[];
  readonly windowTradeCount: number;
  readonly windowsLived: number;
  readonly paperWindowPnls: readonly number[];
  readonly paperWindowSlippageBps: readonly number[];
  readonly paperWindowBaselinePnl: number | null;
  readonly currentWindowStart: number | null;
  readonly currentWindowSlippageTotalBps: number;
  readonly currentWindowSlippageFillCount: number;
  readonly lastCloseTimestamp: number | null;
};

export type QmonPopulation = {
  readonly market: MarketKey;
  readonly qmons: readonly Qmon[];
  readonly createdAt: number;
  readonly lastUpdated: number;
  readonly activeChampionQmonId: QmonId | null;
  readonly marketPaperSessionPnl: number;
  readonly marketConsolidatedPnl: number;
  readonly seatPosition: QmonPosition;
  readonly seatPendingOrder: QmonPendingOrder | null;
  readonly seatLastCloseTimestamp: number | null;
  readonly seatLastWindowStartMs: number | null;
  readonly seatLastSettledWindowStartMs: number | null;
  readonly executionRuntime?: QmonExecutionRuntime;
};

export type QmonExecutionRuntime = {
  readonly route: QmonExecutionRoute;
  readonly executionState: QmonExecutionState;
  readonly pendingIntent: QmonPendingOrder | null;
  readonly orderId: string | null;
  readonly submittedAt: number | null;
  readonly confirmedVenueSeat: QmonConfirmedVenueSeat | null;
  readonly pendingVenueOrders: readonly QmonPendingVenueOrderSnapshot[];
  readonly recoveryStartedAt: number | null;
  readonly lastReconciledAt: number | null;
  readonly lastError: string | null;
  readonly isHalted: boolean;
};

export type QmonFamilyState = {
  readonly populations: readonly QmonPopulation[];
  readonly globalGeneration: number;
  readonly createdAt: number;
  readonly lastUpdated: number;
};

export type GateResult = {
  readonly passed: boolean;
  readonly reason: string | undefined;
};

export type EvaluationResult = {
  readonly qmonId: QmonId;
  readonly action: TradingAction;
  readonly score: number;
  readonly directionalAlpha?: number;
  readonly estimatedNetEvUsd?: number;
  readonly tradeabilityRejectReason?: string | null;
  readonly tradeabilityAssessment?: TradeabilityAssessment;
  readonly gates: {
    readonly trigger: boolean;
    readonly time: boolean;
    readonly regime: boolean;
    readonly threshold: boolean;
  };
};

export type SignalMetadata = {
  readonly id: QmonSignalId;
  readonly signalGroup: "predictive" | "microstructure";
  readonly isHorizonBased: boolean;
};

export type TimeSegment = "early" | "mid" | "late";

export type DirectionRegimeValue = "trending-up" | "trending-down" | "flat";

export type VolatilityRegimeValue = "high" | "normal" | "low";

export type ExchangeWeights = readonly [number, number, number, number];
