/**
 * Script to analyze QMON execution logs and generate detailed statistics
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface QmonDecision {
  timestamp: number;
  market: string;
  action: string;
  score: number;
  triggeredBy: readonly string[];
  fee: number;
  executionPrice: number | null;
  entryPrice: number | null;
  shareCount: number | null;
  priceImpactBps: number | null;
}

interface QmonMetrics {
  totalTrades: number;
  totalPnl: number;
  championScore: number | null;
  paperWindowMedianPnl: number | null;
  paperWindowPnlSum: number;
  paperLongWindowPnlSum: number;
  negativeWindowRateLast10: number;
  worstWindowPnlLast10: number | null;
  recentAvgSlippageBps: number;
  makerExitExpireRate: number;
  isChampionEligible: boolean;
  championEligibilityReasons: readonly string[];
  totalFeesPaid: number;
  winRate: number;
  winCount: number;
  avgScore: number;
  maxDrawdown: number;
  lastUpdate: number;
}

interface QmonGenome {
  signalGenes: readonly {
    signalId: string;
    weights: Record<string, number>;
  }[];
  triggerGenes: readonly {
    triggerId: string;
    isEnabled: boolean;
  }[];
  buyMode: "maker" | "taker";
  sellMode: "maker" | "taker";
  timeWindowGenes: readonly boolean[];
  directionRegimeGenes: readonly boolean[];
  volatilityRegimeGenes: readonly boolean[];
  exchangeWeights: readonly number[];
  maxTradesPerWindow: number;
  maxSlippageBps: number;
  minScoreBuy: number;
  minScoreSell: number;
  stopLossPct: number;
  takeProfitPct: number;
}

interface Qmon {
  id: string;
  market: string;
  genome: QmonGenome;
  role: string;
  lifecycle: string;
  generation: number;
  parentIds: readonly string[];
  createdAt: number;
  metrics: QmonMetrics;
  decisionHistory: readonly QmonDecision[];
  paperWindowPnls: readonly number[];
  paperWindowSlippageBps: readonly number[];
  makerExitExpireSamples: readonly number[];
}

type TradeAnalysis = {
  entryPrice: number;
  exitPrice: number | null;
  entryScore: number;
  exitScore: number;
  shares: number;
  pnl: number;
  fees: number;
  grossPnl: number;
  returnPct: number;
  holdTimeMs: number;
  entryTrigger: string;
  exitReason: string;
  entryTimestamp: number;
  exitTimestamp: number | null;
};

type TriggerPerformance = {
  triggerId: string;
  entryCount: number;
  totalPnl: number;
  avgPnl: number;
  winRate: number;
  avgHoldTimeMs: number;
  totalFees: number;
};

type SignalWeightAnalysis = {
  signalId: string;
  qmonsUsing: number;
  avgTotalPnl: number;
  bestTotalPnl: number;
  worstTotalPnl: number;
  avgWeight: number;
  weightRange: { min: number; max: number };
};

type GenomeParameterAnalysis = {
  parameter: string;
  avgValue: number;
  minValue: number;
  maxValue: number;
  correlationWithPnl: number;
};

/**
 * Parse a QMON JSON file
 */
function parseQmonFile(filePath: string): Qmon | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Qmon;
  } catch {
    return null;
  }
}

/**
 * Extract complete trades from decision history
 */
function extractTrades(decisions: readonly QmonDecision[]): TradeAnalysis[] {
  const trades: TradeAnalysis[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];

    // Check if this is an entry decision (BUY_UP or BUY_DOWN)
    if (decision.action === "BUY_UP" || decision.action === "BUY_DOWN") {
      const entryPrice = decision.executionPrice ?? decision.entryPrice ?? 0;
      const entryScore = decision.score;
      const entryTrigger = decision.triggeredBy?.[0] ?? "unknown";
      const entryTimestamp = decision.timestamp;
      const shares = decision.shareCount ?? 0;
      const entryFee = decision.fee;

      // Look ahead for the corresponding exit (HOLD with different reason or SELL action)
      let exitPrice: number | null = null;
      let exitScore = 0;
      let exitReason = "unknown";
      let exitTimestamp: number | null = null;
      let exitFee = 0;

      for (let j = i + 1; j < decisions.length; j++) {
        const nextDecision = decisions[j];

        // Exit can be HOLD with exit reason or actual SELL action
        if (
          nextDecision.action === "HOLD" &&
          nextDecision.triggeredBy &&
          nextDecision.triggeredBy.length > 0 &&
          (nextDecision.entryPrice === decision.entryPrice || nextDecision.shareCount === shares)
        ) {
          exitPrice = nextDecision.executionPrice;
          exitScore = nextDecision.score;
          exitReason = nextDecision.triggeredBy[0] ?? "unknown";
          exitTimestamp = nextDecision.timestamp;
          exitFee = nextDecision.fee;
          break;
        }

        // Also check for market-settled (exitPrice = 0 or 1 based on outcome)
        if (nextDecision.triggeredBy?.includes("market-settled")) {
          exitPrice = nextDecision.executionPrice;
          exitScore = nextDecision.score;
          exitReason = "market-settled";
          exitTimestamp = nextDecision.timestamp;
          exitFee = nextDecision.fee;
          break;
        }
      }

      // Calculate PnL
      const grossPnl = exitPrice !== null ? exitPrice * shares - entryPrice * shares : 0;
      const totalFees = entryFee + exitFee;
      const pnl = grossPnl - totalFees;
      const returnPct = entryPrice > 0 ? (exitPrice ?? 0 - entryPrice) / entryPrice : 0;
      const holdTimeMs = exitTimestamp !== null ? exitTimestamp - entryTimestamp : 0;

      trades.push({
        entryPrice,
        exitPrice,
        entryScore,
        exitScore,
        shares,
        pnl,
        fees: totalFees,
        grossPnl,
        returnPct,
        holdTimeMs,
        entryTrigger,
        exitReason,
        entryTimestamp,
        exitTimestamp,
      });
    }
  }

  return trades;
}

/**
 * Analyze all QMON files in a directory
 */
function analyzeDirectory(dataPath: string): {
  totalQmons: number;
  totalTrades: number;
  totalPnl: number;
  totalFees: number;
  grossPnl: number;
  winRate: number;
  avgReturnPct: number;
  avgHoldTimeMs: number;
  tradesByTrigger: Record<string, TriggerPerformance>;
  tradesByExitReason: Record<string, { count: number; totalPnl: number; avgPnl: number }>;
  signalAnalysis: SignalWeightAnalysis[];
  genomeAnalysis: GenomeParameterAnalysis[];
  problematicTrades: TradeAnalysis[];
  topQmons: Array<{ id: string; totalPnl: number; winRate: number; totalTrades: number }>;
  genomeConfigs: Record<string, number>;
} {
  const files = readdirSync(dataPath).filter((f) => f.endsWith(".json") && f !== "_metadata.json");

  const allTrades: TradeAnalysis[] = [];
  const allQmons: Qmon[] = [];
  const tradesByTrigger: Record<string, TradeAnalysis[]> = {};
  const tradesByExitReason: Record<string, TradeAnalysis[]> = {};

  // Load all QMONs
  for (const file of files) {
    const qmon = parseQmonFile(join(dataPath, file));
    if (qmon) {
      allQmons.push(qmon);

      // Extract trades from decision history
      const trades = extractTrades(qmon.decisionHistory);
      for (const trade of trades) {
        allTrades.push(trade);

        // Group by entry trigger
        if (!tradesByTrigger[trade.entryTrigger]) {
          tradesByTrigger[trade.entryTrigger] = [];
        }
        tradesByTrigger[trade.entryTrigger].push(trade);

        // Group by exit reason
        if (!tradesByExitReason[trade.exitReason]) {
          tradesByExitReason[trade.exitReason] = [];
        }
        tradesByExitReason[trade.exitReason].push(trade);
      }
    }
  }

  // Calculate aggregate statistics
  const totalTradesCount = allTrades.length;
  const winningTrades = allTrades.filter((t) => t.pnl > 0);
  const totalPnl = allTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalFees = allTrades.reduce((sum, t) => sum + t.fees, 0);
  const grossPnl = allTrades.reduce((sum, t) => sum + t.grossPnl, 0);
  const winRate = totalTradesCount > 0 ? winningTrades.length / totalTradesCount : 0;
  const avgReturnPct = totalTradesCount > 0 ? allTrades.reduce((sum, t) => sum + t.returnPct, 0) / totalTradesCount : 0;
  const avgHoldTimeMs = totalTradesCount > 0 ? allTrades.reduce((sum, t) => sum + t.holdTimeMs, 0) / totalTradesCount : 0;

  // Analyze trigger performance
  const triggerPerformance: Record<string, TriggerPerformance> = {};
  for (const [triggerId, trades] of Object.entries(tradesByTrigger)) {
    const wins = trades.filter((t) => t.pnl > 0);
    triggerPerformance[triggerId] = {
      triggerId,
      entryCount: trades.length,
      totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
      avgPnl: trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length,
      winRate: wins.length / trades.length,
      avgHoldTimeMs: trades.reduce((sum, t) => sum + t.holdTimeMs, 0) / trades.length,
      totalFees: trades.reduce((sum, t) => sum + t.fees, 0),
    };
  }

  // Analyze exit reasons
  const exitReasonAnalysis: Record<string, { count: number; totalPnl: number; avgPnl: number }> = {};
  for (const [reason, trades] of Object.entries(tradesByExitReason)) {
    exitReasonAnalysis[reason] = {
      count: trades.length,
      totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
      avgPnl: trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length,
    };
  }

  // Analyze signal weights
  const signalAnalysis: SignalWeightAnalysis[] = [];
  const signalMap: Record<
    string,
    {
      qmons: number;
      totalPnl: number;
      pnls: number[];
      weights: number[];
    }
  > = {};

  for (const qmon of allQmons) {
    for (const signalGene of qmon.genome.signalGenes) {
      if (!signalMap[signalGene.signalId]) {
        signalMap[signalGene.signalId] = {
          qmons: 0,
          totalPnl: 0,
          pnls: [],
          weights: [],
        };
      }

      signalMap[signalGene.signalId].qmons++;
      signalMap[signalGene.signalId].totalPnl += qmon.metrics.totalPnl;
      signalMap[signalGene.signalId].pnls.push(qmon.metrics.totalPnl);

      // Collect all weights (including horizon-specific)
      for (const weight of Object.values(signalGene.weights)) {
        if (typeof weight === "number" && weight !== 0) {
          signalMap[signalGene.signalId].weights.push(weight);
        }
      }
    }
  }

  for (const [signalId, data] of Object.entries(signalMap)) {
    signalAnalysis.push({
      signalId,
      qmonsUsing: data.qmons,
      avgTotalPnl: data.totalPnl / data.qmons,
      bestTotalPnl: Math.max(...data.pnls),
      worstTotalPnl: Math.min(...data.pnls),
      avgWeight: data.weights.length > 0 ? data.weights.reduce((sum, w) => sum + Math.abs(w), 0) / data.weights.length : 0,
      weightRange: {
        min: data.weights.length > 0 ? Math.min(...data.weights) : 0,
        max: data.weights.length > 0 ? Math.max(...data.weights) : 0,
      },
    });
  }

  // Sort by performance
  signalAnalysis.sort((a, b) => b.avgTotalPnl - a.avgTotalPnl);

  // Analyze genome parameters
  const genomeAnalysis: GenomeParameterAnalysis[] = [];
  const params = [
    { key: "stopLossPct", readValue: (qmon: QmonData) => qmon.genome.stopLossPct },
    { key: "takeProfitPct", readValue: (qmon: QmonData) => qmon.genome.takeProfitPct },
    { key: "maxSlippageBps", readValue: (qmon: QmonData) => qmon.genome.maxSlippageBps },
    { key: "minScoreBuy", readValue: (qmon: QmonData) => qmon.genome.minScoreBuy },
    { key: "minScoreSell", readValue: (qmon: QmonData) => qmon.genome.minScoreSell },
    { key: "maxTradesPerWindow", readValue: (qmon: QmonData) => qmon.genome.maxTradesPerWindow },
  ];

  for (const param of params) {
    const values: { value: number; pnl: number }[] = [];

    for (const qmon of allQmons) {
      const value = param.readValue(qmon);
      if (typeof value === "number") {
        values.push({ value, pnl: qmon.metrics.totalPnl });
      }
    }

    if (values.length > 0) {
      const avgValue = values.reduce((sum, v) => sum + v.value, 0) / values.length;

      // Calculate correlation
      const meanValue = values.reduce((sum, v) => sum + v.value, 0) / values.length;
      const meanPnl = values.reduce((sum, v) => sum + v.pnl, 0) / values.length;
      let numerator = 0;
      let denominatorValue = 0;
      let denominatorPnl = 0;

      for (const v of values) {
        numerator += (v.value - meanValue) * (v.pnl - meanPnl);
        denominatorValue += (v.value - meanValue) ** 2;
        denominatorPnl += (v.pnl - meanPnl) ** 2;
      }

      const correlation = denominatorValue > 0 && denominatorPnl > 0 ? numerator / Math.sqrt(denominatorValue * denominatorPnl) : 0;

      genomeAnalysis.push({
        parameter: param.key,
        avgValue,
        minValue: Math.min(...values.map((v) => v.value)),
        maxValue: Math.max(...values.map((v) => v.value)),
        correlationWithPnl: correlation,
      });
    }
  }

  // Find problematic trades (large losses)
  const problematicTrades = [...allTrades]
    .filter((t) => t.pnl < -0.3)
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 20);

  // Top performing QMONs
  const topQmons = allQmons
    .filter((q) => q.metrics.totalTrades >= 5)
    .map((q) => ({
      id: q.id,
      totalPnl: q.metrics.totalPnl,
      winRate: q.metrics.winRate,
      totalTrades: q.metrics.totalTrades,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .slice(0, 10);

  // Analyze genome configuration patterns
  const genomeConfigs: Record<string, number> = {};
  for (const qmon of allQmons) {
    const key = `${qmon.genome.buyMode}/${qmon.genome.sellMode}|SL:${qmon.genome.stopLossPct}|TP:${qmon.genome.takeProfitPct}|trades:${qmon.genome.maxTradesPerWindow}`;
    genomeConfigs[key] = (genomeConfigs[key] || 0) + 1;
  }

  return {
    totalQmons: allQmons.length,
    totalTrades: totalTradesCount,
    totalPnl,
    totalFees,
    grossPnl,
    winRate,
    avgReturnPct,
    avgHoldTimeMs,
    tradesByTrigger: triggerPerformance,
    tradesByExitReason: exitReasonAnalysis,
    signalAnalysis,
    genomeAnalysis,
    problematicTrades,
    topQmons,
    genomeConfigs,
  };
}

/**
 * Generate markdown report
 */
function generateReport(analysis: ReturnType<typeof analyzeDirectory>): string {
  const lines: string[] = [];

  lines.push("# QMON Trading Analysis Report");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total QMONs Analyzed | ${analysis.totalQmons} |`);
  lines.push(`| Total Trades | ${analysis.totalTrades} |`);
  lines.push(`| Total PnL | **$${analysis.totalPnl.toFixed(2)}** |`);
  lines.push(`| Gross PnL (before fees) | $${analysis.grossPnl.toFixed(2)} |`);
  lines.push(`| Total Fees Paid | $${analysis.totalFees.toFixed(2)} |`);
  lines.push(`| Net Win Rate | ${(analysis.winRate * 100).toFixed(1)}% |`);
  lines.push(`| Avg Return per Trade | ${(analysis.avgReturnPct * 100).toFixed(2)}% |`);
  lines.push(`| Avg Hold Time | ${(analysis.avgHoldTimeMs / 1000).toFixed(0)}s |`);
  lines.push("");

  // Critical Findings
  lines.push("## Critical Findings");
  lines.push("");

  if (analysis.totalPnl < 0) {
    lines.push("### ❌ Overall Loss");
    lines.push("");
    lines.push(`The system is **losing money** with a total loss of $${Math.abs(analysis.totalPnl).toFixed(2)}.`);
    lines.push("");
  }

  if (analysis.totalFees > Math.abs(analysis.grossPnl)) {
    lines.push("### ⚠️ Fees Eating Profits");
    lines.push("");
    lines.push(`**Trading fees ($${analysis.totalFees.toFixed(2)}) exceed gross profits ($${analysis.grossPnl.toFixed(2)}).**`);
    lines.push("Consider:");
    lines.push("- Increasing maker order usage for lower fees");
    lines.push("- Raising entry/exit score thresholds to reduce low-conviction trades");
    lines.push("");
  }

  // Trigger Performance Analysis
  lines.push("## Trigger Performance");
  lines.push("");
  lines.push("| Trigger | Trades | Total PnL | Avg PnL | Win Rate | Avg Hold |");
  lines.push("|---------|--------|-----------|---------|----------|----------|");

  for (const trigger of Object.values(analysis.tradesByTrigger).sort((a, b) => b.totalPnl - a.totalPnl)) {
    lines.push(
      `| ${trigger.triggerId} | ${trigger.entryCount} | $${trigger.totalPnl.toFixed(2)} | $${trigger.avgPnl.toFixed(3)} | ${(trigger.winRate * 100).toFixed(0)}% | ${(trigger.avgHoldTimeMs / 1000).toFixed(0)}s |`,
    );
  }
  lines.push("");

  // Exit Reason Analysis
  lines.push("## Exit Reason Analysis");
  lines.push("");
  lines.push("| Exit Reason | Count | Total PnL | Avg PnL |");
  lines.push("|-------------|-------|-----------|---------|");

  for (const [reason, data] of Object.entries(analysis.tradesByExitReason).sort((a, b) => b[1].totalPnl - a[1].totalPnl)) {
    lines.push(`| ${reason} | ${data.count} | $${data.totalPnl.toFixed(2)} | $${data.avgPnl.toFixed(3)} |`);
  }
  lines.push("");

  // Signal Weight Analysis
  lines.push("## Signal Weight Analysis");
  lines.push("");
  lines.push("Which signals correlate with better performance:");
  lines.push("");
  lines.push("| Signal | QMONs Using | Avg Total PnL | Best | Worst | Avg Weight |");
  lines.push("|--------|-------------|---------------|------|-------|------------|");

  for (const signal of analysis.signalAnalysis.slice(0, 15)) {
    lines.push(
      `| ${signal.signalId} | ${signal.qmonsUsing} | $${signal.avgTotalPnl.toFixed(3)} | $${signal.bestTotalPnl.toFixed(2)} | $${signal.worstTotalPnl.toFixed(2)} | ${signal.avgWeight.toFixed(2)} |`,
    );
  }
  lines.push("");

  // Genome Parameter Analysis
  lines.push("## Genome Parameter Correlation with PnL");
  lines.push("");
  lines.push("| Parameter | Avg Value | Min | Max | Correlation with PnL |");
  lines.push("|-----------|-----------|-----|-----|---------------------|");

  for (const param of analysis.genomeAnalysis) {
    const correlationIcon = param.correlationWithPnl > 0.1 ? "🟢" : param.correlationWithPnl < -0.1 ? "🔴" : "⚪";
    lines.push(
      `| ${param.parameter} | ${param.avgValue.toFixed(3)} | ${param.minValue.toFixed(3)} | ${param.maxValue.toFixed(3)} | ${correlationIcon} ${param.correlationWithPnl.toFixed(3)} |`,
    );
  }
  lines.push("");

  // Top Performing QMONs
  lines.push("## Top Performing QMONs");
  lines.push("");
  lines.push("| QMON ID | Total PnL | Win Rate | Trades |");
  lines.push("|---------|-----------|----------|--------|");

  for (const qmon of analysis.topQmons) {
    lines.push(`| ${qmon.id} | $${qmon.totalPnl.toFixed(2)} | ${(qmon.winRate * 100).toFixed(0)}% | ${qmon.totalTrades} |`);
  }
  lines.push("");

  // Problematic Trades
  if (analysis.problematicTrades.length > 0) {
    lines.push("## Problematic Trades (Losses > $0.30)");
    lines.push("");
    lines.push("| Entry Price | Exit Price | Loss | Return | Hold Time | Trigger | Exit Reason |");
    lines.push("|-------------|------------|------|--------|-----------|---------|-------------|");

    for (const trade of analysis.problematicTrades.slice(0, 15)) {
      lines.push(
        `| $${trade.entryPrice.toFixed(3)} | $${trade.exitPrice?.toFixed(3) ?? "N/A"} | $${trade.pnl.toFixed(3)} | ${(trade.returnPct * 100).toFixed(1)}% | ${(trade.holdTimeMs / 1000).toFixed(0)}s | ${trade.entryTrigger} | ${trade.exitReason} |`,
      );
    }
    lines.push("");
  }

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");

  // Analyze exit reasons
  const stopLossData = analysis.tradesByExitReason["stop-loss-hit"];
  if (stopLossData && stopLossData.totalPnl < 0) {
    lines.push("### 1. Stop Loss Issues");
    lines.push("");
    lines.push(`- Stop losses are triggering **${stopLossData.count} times** with total loss of $${stopLossData.totalPnl.toFixed(2)}`);
    lines.push(`- Average loss per stop-loss: $${(stopLossData.totalPnl / stopLossData.count).toFixed(3)}`);
    lines.push("- **Recommendation:** Consider adjusting stop loss thresholds or using wider stops with better entry timing");
    lines.push("");
  }

  const takeProfitData = analysis.tradesByExitReason["take-profit-hit"];
  if (takeProfitData && takeProfitData.totalPnl > 0) {
    lines.push("### 2. Take Profit Effectiveness");
    lines.push("");
    lines.push(`- Take profits captured **$${takeProfitData.totalPnl.toFixed(2)}** across ${takeProfitData.count} exits`);
    lines.push(`- Average gain per take-profit: $${(takeProfitData.totalPnl / takeProfitData.count).toFixed(3)}`);
    lines.push("- **Recommendation:** Take profit is working well, consider expanding its usage");
    lines.push("");
  }

  // Analyze triggers
  const momentumTrades = analysis.tradesByTrigger["momentum-shift"];
  if (momentumTrades && momentumTrades.totalPnl < 0) {
    lines.push("### 3. Momentum Signal Issues");
    lines.push("");
    lines.push(`- Momentum trigger generated **$${momentumTrades.totalPnl.toFixed(2)}** losses across ${momentumTrades.entryCount} trades`);
    lines.push(`- Win rate: ${(momentumTrades.winRate * 100).toFixed(0)}%`);
    lines.push("- **Recommendation:** Review momentum signal weights and thresholds");
    lines.push("");
  }

  const breakoutTrades = analysis.tradesByTrigger.breakout;
  if (breakoutTrades && breakoutTrades.totalPnl < 0) {
    lines.push("### 4. Breakout Signal Issues");
    lines.push("");
    lines.push(`- Breakout trigger generated **$${breakoutTrades.totalPnl.toFixed(2)}** losses across ${breakoutTrades.entryCount} trades`);
    lines.push(`- Win rate: ${(breakoutTrades.winRate * 100).toFixed(0)}%`);
    lines.push("- **Recommendation:** Breakout may be triggering on false moves; consider filtering by volatility regime");
    lines.push("");
  }

  // Signal recommendations
  lines.push("### 5. Signal Optimization Opportunities");
  lines.push("");

  // Find signals with high negative correlation
  const negativeSignals = analysis.signalAnalysis.filter((s) => s.avgTotalPnl < -0.1);
  if (negativeSignals.length > 0) {
    lines.push("**Signals to reduce weight or disable:**");
    for (const signal of negativeSignals) {
      lines.push(`- **${signal.signalId}**: Avg PnL $${signal.avgTotalPnl.toFixed(3)} across ${signal.qmonsUsing} QMONs`);
    }
    lines.push("");
  }

  const positiveSignals = analysis.signalAnalysis.filter((s) => s.avgTotalPnl > 0.1);
  if (positiveSignals.length > 0) {
    lines.push("**Signals to increase weight:**");
    for (const signal of positiveSignals) {
      lines.push(`- **${signal.signalId}**: Avg PnL $${signal.avgTotalPnl.toFixed(3)} across ${signal.qmonsUsing} QMONs`);
    }
    lines.push("");
  }

  // Fee optimization
  if (analysis.totalFees > 0) {
    const feeRatio = analysis.totalFees / (Math.abs(analysis.grossPnl) + analysis.totalFees);
    if (feeRatio > 0.3) {
      lines.push("### 6. Fee Reduction Priority");
      lines.push("");
      lines.push(`- **${(feeRatio * 100).toFixed(0)}%** of gross PnL is going to fees`);
      lines.push("- **Action:** Consider increasing maker order usage for entries/exits");
      lines.push("- **Action:** Raise minimum score thresholds to only trade on higher conviction");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// Main execution
const dataPath = process.argv[2] ?? "./data/sol-15m";
const analysis = analyzeDirectory(dataPath);
const report = generateReport(analysis);

console.log(report);
