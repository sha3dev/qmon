import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { QmonPresetStrategyService } from "../src/qmon/qmon-preset-strategy.service.ts";

test("QmonPresetStrategyService exposes 400 uniquely named preset strategies with non-duplicated rule signatures", () => {
  const presetStrategyService = QmonPresetStrategyService.createDefault();
  const presetStrategyDefinitions = presetStrategyService.getPresetStrategyDefinitions();
  const strategyIds = new Set(presetStrategyDefinitions.map((presetStrategyDefinition) => presetStrategyDefinition.presetStrategyId));
  const strategyNames = new Set(presetStrategyDefinitions.map((presetStrategyDefinition) => presetStrategyDefinition.strategyName));
  const strategyDescriptions = new Set(presetStrategyDefinitions.map((presetStrategyDefinition) => presetStrategyDefinition.strategyDescription));
  const strategySignatures = new Set(
    presetStrategyDefinitions.map((presetStrategyDefinition) =>
      JSON.stringify({
        presetFamily: presetStrategyDefinition.presetFamily,
        triggerIds: presetStrategyDefinition.triggerIds,
        timeWindowGenes: presetStrategyDefinition.timeWindowGenes,
        directionRegimeGenes: presetStrategyDefinition.directionRegimeGenes,
        volatilityRegimeGenes: presetStrategyDefinition.volatilityRegimeGenes,
        entryPolicy: presetStrategyDefinition.entryPolicy,
        executionPolicy: presetStrategyDefinition.executionPolicy,
        exitPolicy: presetStrategyDefinition.exitPolicy,
        minScoreBuy: presetStrategyDefinition.minScoreBuy,
        minScoreSell: presetStrategyDefinition.minScoreSell,
        minSignalCount: presetStrategyDefinition.minSignalCount,
        anchorPrice: presetStrategyDefinition.anchorPrice,
        slopeThreshold: presetStrategyDefinition.slopeThreshold,
        edgeThreshold: presetStrategyDefinition.edgeThreshold,
        distanceThreshold: presetStrategyDefinition.distanceThreshold,
        spreadLimit: presetStrategyDefinition.spreadLimit,
        depthThreshold: presetStrategyDefinition.depthThreshold,
        imbalanceThreshold: presetStrategyDefinition.imbalanceThreshold,
        stalenessLimit: presetStrategyDefinition.stalenessLimit,
        pressureThreshold: presetStrategyDefinition.pressureThreshold,
        alphaScale: presetStrategyDefinition.alphaScale,
      }),
    ),
  );

  assert.equal(presetStrategyDefinitions.length, config.QMON_PRESET_QMON_COUNT);
  assert.equal(strategyIds.size, presetStrategyDefinitions.length);
  assert.equal(strategyNames.size, presetStrategyDefinitions.length);
  assert.equal(strategyDescriptions.size, presetStrategyDefinitions.length);
  assert.equal(strategySignatures.size, presetStrategyDefinitions.length);
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
  assert.equal(compatibilityGenome.entryPolicy.allowNoTrigger, false);
  assert.equal(compatibilityGenome.triggerGenes.filter((triggerGene) => triggerGene.isEnabled).length > 0, true);
});
