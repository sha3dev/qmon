import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonPresetStrategyService } from "../src/qmon/qmon-preset-strategy.service.ts";

test("QmonPresetStrategyService exposes the configured preset strategy count with diversified families and unique signatures", () => {
  const presetStrategyService = QmonPresetStrategyService.createDefault();
  const presetStrategyDefinitions = presetStrategyService.getPresetStrategyDefinitions();
  const strategyIds = new Set(presetStrategyDefinitions.map((presetStrategyDefinition) => presetStrategyDefinition.presetStrategyId));
  const strategyNames = new Set(presetStrategyDefinitions.map((presetStrategyDefinition) => presetStrategyDefinition.strategyName));
  const strategyDescriptions = new Set(presetStrategyDefinitions.map((presetStrategyDefinition) => presetStrategyDefinition.strategyDescription));
  const strategySignatures = new Set(
    presetStrategyDefinitions.map((presetStrategyDefinition) =>
      JSON.stringify({
        presetFamily: presetStrategyDefinition.presetFamily,
        beliefWeights: presetStrategyDefinition.beliefWeights,
        timeWindowGenes: presetStrategyDefinition.timeWindowGenes,
        directionRegimeGenes: presetStrategyDefinition.directionRegimeGenes,
        volatilityRegimeGenes: presetStrategyDefinition.volatilityRegimeGenes,
        entryPolicy: presetStrategyDefinition.entryPolicy,
        executionPolicy: presetStrategyDefinition.executionPolicy,
        exitPolicy: presetStrategyDefinition.exitPolicy,
        riskBudgetUsd: presetStrategyDefinition.riskBudgetUsd,
      }),
    ),
  );

  assert.equal(presetStrategyDefinitions.length, config.QMON_PRESET_QMON_COUNT);
  assert.equal(strategyIds.size, presetStrategyDefinitions.length);
  assert.equal(strategyNames.size, presetStrategyDefinitions.length);
  assert.equal(strategyDescriptions.size, presetStrategyDefinitions.length);
  assert.equal(strategySignatures.size, presetStrategyDefinitions.length);
  assert.equal(presetStrategyDefinitions.every((presetStrategyDefinition) => presetStrategyDefinition.riskBudgetUsd >= 1.05), true);
  assert.equal(presetStrategyDefinitions.some((presetStrategyDefinition) => presetStrategyDefinition.presetFamily === "consensus-resolver"), true);
  assert.equal(presetStrategyDefinitions.some((presetStrategyDefinition) => presetStrategyDefinition.presetFamily === "trend-confirmation"), true);
  assert.equal(presetStrategyDefinitions.some((presetStrategyDefinition) => presetStrategyDefinition.presetFamily === "divergence-capture"), true);
});

test("QmonPresetStrategyService builds compatibility genomes without losing strategy metadata lookup", () => {
  const presetStrategyService = QmonPresetStrategyService.createDefault();
  const [presetStrategyDefinition] = presetStrategyService.getPresetStrategyDefinitions(1);

  if (presetStrategyDefinition === undefined) {
    throw new Error("expected one preset strategy definition");
  }

  const compatibilityGenome = presetStrategyService.createCompatibilityGenome(presetStrategyDefinition);
  const loadedPresetStrategyDefinition = presetStrategyService.getPresetStrategyDefinition(presetStrategyDefinition.presetStrategyId);

  assert.ok(loadedPresetStrategyDefinition);
  assert.equal(loadedPresetStrategyDefinition.strategyName, presetStrategyDefinition.strategyName);
  assert.equal(compatibilityGenome.entryPolicy.confidenceThreshold >= config.QMON_MIN_FINAL_OUTCOME_PROBABILITY - 0.06, true);
  assert.equal(compatibilityGenome.riskBudgetUsd > 0, true);
});
