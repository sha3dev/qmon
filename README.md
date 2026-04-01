# @sha3/polymarket-quant

Real-time signal calculation and taker-only QMON simulation for Polymarket crypto markets.

The service ingests snapshot data, computes normalized structured signals, evaluates a family of QMON agents, mirrors the active market champion into a separate seat ledger, persists the full family state, and exposes dashboards plus JSON APIs for operators.

## Setup

```bash
npm install
npm run build
npm run test
npm run start
```

Default URLs:

- `http://localhost:3000/` — QMON dashboard
- `http://localhost:3000/signals.html` — signal dashboard

Useful local commands:

```bash
npm run typecheck
npm run lint
npm run standards:check
npm run check
```

## Runtime Model

The live loop is:

1. `SnapshotService` receives snapshots on a fixed interval.
2. `SignalEngine` computes one canonical payload with `calculateStructured()`.
3. `TriggerEngine` emits transition-based trigger events from the structured payload.
4. `RegimeEngine` classifies direction and volatility regimes per asset.
5. `QmonEngine` evaluates every market population in taker-only paper mode.
6. The active champion, if any, also drives a separate market seat ledger.
7. `QmonPersistenceService` writes the full family state to `data/family-state.json`.
8. `HttpServerService` serves dashboards and APIs.

Important behavior:

- There is no maker mode.
- There is no live `real` routing mode.
- `/api/signals/structured` is the only signal API contract.
- `Market CPnL` is updated only by the champion seat, not by all candidate QMONs.

## HTTP API

### HTML routes

- `GET /` returns the operator dashboard.
- `GET /signals.html` returns the signal dashboard.
- `GET /qmons.html` redirects to `/`.
- `GET /dashboard` redirects to `/`.

### Signal route

- `GET /api/signals/structured`
  - Status: `200`
  - Response: structured asset/window signals plus `triggers`, `regimes`, and `regimeEvents`

Example:

```json
{
  "btc": {
    "chainlinkPrice": 100000,
    "signals": {
      "oracleLag": 0.18,
      "dispersion": 0.04,
      "velocity": { "30s": 0.12, "2m": 0.08, "5m": null }
    },
    "windows": {
      "5m": {
        "signals": {
          "distance": 0.11,
          "zScore": 0.07,
          "edge": 0.09,
          "tokenPressure": 0.02,
          "marketEfficiency": -0.01
        },
        "prices": {
          "priceToBeat": 100000,
          "upPrice": 0.41,
          "downPrice": 0.59,
          "marketStartMs": 1710000000000,
          "marketEndMs": 1710000300000
        }
      }
    }
  },
  "triggers": [],
  "regimes": {},
  "regimeEvents": []
}
```

### QMON routes

- `GET /api/qmons`
  - Status: `200`
  - Response: full `QmonFamilyState`
- `GET /api/qmons/stats`
  - Status: `200`
  - Response: aggregated family statistics
- `GET /api/qmons/:id`
  - Status: `200` when found, `404` otherwise
  - Response: one `Qmon`

### Diagnostics routes

- `GET /api/qmons/activity?limit=50`
- `GET /api/qmons/cpnl-log?range=24h&limit=100`
- `GET /api/qmons/diagnostics/overview?range=24h`
- `GET /api/qmons/diagnostics/market?market=btc-5m&range=24h`
  - Returns `400` when `market` is missing
- `GET /api/qmons/diagnostics/events?market=btc-5m&category=execution&range=24h&limit=100`
- `GET /api/qmons/market-activity?market=btc-5m&range=24h&limit=500`
  - Returns `400` when `market` is missing

Diagnostic ranges are `24h`, `7d`, or `30d`.

## Public API

### `ServiceRuntime`

Creates and wires the live service.

- `ServiceRuntime.createDefault()`
  - Builds snapshot ingestion, signal engine, QMON engine, persistence, diagnostics, and HTTP server dependencies.
  - Returns a fully configured runtime.
- `buildServer()`
  - Returns a server instance without opening a port.
- `startServer()`
  - Starts the HTTP server on `config.DEFAULT_PORT`.
  - Registers the snapshot listener and begins the live loop.

Example:

```ts
import { ServiceRuntime } from "@sha3/polymarket-quant";

const runtime = await ServiceRuntime.createDefault();
runtime.startServer();
```

### `SignalEngine`

Computes the canonical structured signal payload.

- `SignalEngine.createDefault()`
  - Builds the engine with configured assets, windows, horizons, and exchanges.
- `calculateStructured(snapshots)`
  - Returns the canonical `StructuredSignalResult`.
  - Includes asset-level signals, window-level signals, and extracted market price fields.
- `calculateExchangeSignalsWithWeights(snapshots, asset, exchangeWeights)`
  - Recomputes exchange-sensitive signals for one asset using explicit exchange weights.
  - Used by QMON evaluation for genome-specific weighting.

### `TriggerEngine`

Produces transition-based trigger events from structured signals.

- `TriggerEngine.createDefault()`
  - Creates a trigger engine with default thresholds and previous-state tracking.
- `evaluate(current)`
  - Returns the trigger events that fired on the latest transition.

### `RegimeEngine`

Computes market direction and volatility regimes from structured signals.

- `RegimeEngine.createDefault()`
  - Creates a default regime classifier.
- `evaluate(current)`
  - Returns current states plus regime-change events.
- `getCurrentStates()`
  - Returns the last computed `RegimeResult`.

### `QmonEngine`

Owns the taker-only paper family and champion seat logic.

- `QmonEngine.createDefault(assets, windows, signalEngine?, validationLogService?)`
  - Creates the engine with default genome, champion, evolution, execution, and hydration services.
- `initializePopulations()`
  - Seeds one deterministic population per market.
- `getFamilyState()`
  - Returns the full `QmonFamilyState`.
- `getPopulation(market)`
  - Returns one market population or `null`.
- `getQmon(id)`
  - Returns one QMON or `null`.
- `getAllQmons()`
  - Returns every QMON across markets.
- `getQmonsForMarket(market)`
  - Returns every QMON for one market.
- `updateTriggers(triggers)`
  - Stores the latest trigger events for evaluation.
- `updateSnapshots(snapshots)`
  - Stores the latest snapshot buffer for weighted signal recalculation and replay.
- `evaluateAll(signals, regimes, snapshots?)`
  - Evaluates every configured market population.
- `consumeMutationState()`
  - Returns whether evaluation mutated state and whether the mutation was critical for persistence.
- `evaluatePopulation(market, signals, regimes, firedTriggerIds, snapshots?, evaluationOptions?)`
  - Evaluates one market population.
  - Processes pending taker orders, opens/closes paper positions, updates champion selection, and syncs the champion seat.
- `evaluateQmon(qmon, signalValues, firedTriggerIds, directionRegime, volatilityRegime, timeSegment)`
  - Returns one decision result without mutating family state.
- `setFamilyState(state)`
  - Replaces the full in-memory family state.
- `getStats()`
  - Returns top-level family counters for the dashboard and stats API.

### `QmonGenomeService`

Builds, validates, mutates, and seeds QMON genomes.

- `QmonGenomeService.createDefault()`
  - Creates the default genome service with built-in signal metadata.
- `getSignalMetadata()`
  - Returns available signal definitions and weight bounds.
- `getSignalInfo(signalId)`
  - Returns one signal definition or `null`.
- `getAvailableTriggers()`
  - Returns all trigger ids.
- `validateSignalGene(gene)`
  - Checks a signal gene against its allowed weight range.
- `validateThresholds(thresholds)`
  - Checks buy, sell, stop-loss, and take-profit thresholds.
- `validateGenome(genome)`
  - Validates a full genome.
- `generateSignalGenes(density, strategy)`
  - Generates signal genes for random exploration.
- `generateTriggerGenes(density)`
  - Generates trigger genes with enabled/disabled states.
- `generateTimeWindowGenes()`
  - Generates time-segment gates.
- `generateDirectionRegimeGenes()`
  - Generates direction-regime gates.
- `generateVolatilityRegimeGenes()`
  - Generates volatility-regime gates.
- `generateScoreThresholds()`
  - Generates a valid threshold bundle.
- `createOffspringGenome(parentAGenome, parentBGenome, mutationRate)`
  - Produces a child genome for evolution.
- `generateRandomGenome(strategy)`
  - Produces one random genome.
- `generateSeededGenome(seedType)`
  - Produces one hand-seeded baseline genome.
- `generateInitialPopulation(populationSize?)`
  - Produces the deterministic taker-only bootstrap population.

### `QmonPersistenceService`

Persists the whole family state in one atomic file.

- `QmonPersistenceService.createDefault(dataDir?)`
  - Creates a persistence service rooted at `./data` by default.
- `saveQmon(qmon)`
  - Upserts one QMON into the stored family state.
- `savePopulation(population)`
  - Upserts one population into the stored family state.
- `save(state)`
  - Writes the full family state to `family-state.json`.
- `load()`
  - Reads the full family state or returns `null`.
- `loadPopulation(market)`
  - Reads one stored population or returns `null`.
- `exists()`
  - Returns whether the family-state file already exists.
- `deleteQmon(market, qmonId)`
  - Removes one QMON from one stored market population.
- `getDataDir()`
  - Returns the configured storage directory.
- `generateUniqueId()`
  - Returns a fresh QMON id.
- `getAllMarkets()`
  - Returns every configured market derived from `SIGNAL_ASSETS × SIGNAL_WINDOWS`.

### Exported types

- `SignalValue` — one normalized signal value or `null`
- `HorizonSignalValues` — horizon-keyed signal map
- `StructuredSignalResult` — canonical signal payload
- `TriggerEvent`, `TriggerSeverity` — trigger output contracts
- `DirectionRegime`, `RegimeEvent`, `RegimeResult`, `RegimeState`, `VolatilityRegime` — regime contracts
- `MarketKey`, `Qmon`, `QmonFamilyState`, `QmonGenome`, `QmonLifecycle`, `QmonMetrics`, `QmonRole`, `TradingAction` — QMON contracts
- `generateQmonId()` — exported id generator

## Configuration

All runtime configuration comes from `src/config.ts`.

| Key | Purpose | Default |
| --- | --- | --- |
| `RESPONSE_CONTENT_TYPE` | Default HTTP content type for JSON responses. | `application/json` |
| `DEFAULT_PORT` | HTTP port used by `startServer()`. | `3000` |
| `SERVICE_NAME` | Service label used by the process. | `@sha3/polymarket-quant` |
| `SNAPSHOT_INTERVAL_MS` | Snapshot polling/listener interval. | `500` |
| `SIGNAL_HORIZONS_SEC` | Lookback horizons for multi-horizon signals. | `30, 120, 300` |
| `SIGNAL_ASSETS` | Assets with active signal and QMON markets. | `btc, eth, sol, xrp` |
| `SIGNAL_WINDOWS` | Market windows evaluated per asset. | `5m, 15m` |
| `SIGNAL_EXCHANGES` | Exchanges used for exchange-derived signals. | `binance, coinbase, kraken, okx` |
| `MAX_MAX_TRADES_PER_WINDOW` | Upper bound for genome `maxTradesPerWindow`. | `4` |
| `MAX_MAX_SLIPPAGE_BPS` | Upper bound for genome `maxSlippageBps`. | `1500` |
| `QMON_PERSIST_CHECKPOINT_MS` | Minimum interval between non-critical state saves. | `10000` |
| `QMON_EVOLUTION_ENABLED` | Enables population replacement during window rollovers. | `true` |
| `QMON_EVOLUTION_REPLACEMENT_RATE` | Share of the active pool replaced on a rollover. | `0.02` |
| `QMON_EVOLUTION_MIN_PARENT_WINDOWS` | Minimum completed windows before a QMON can reproduce. | `10` |
| `QMON_EVOLUTION_NEWBORN_PROTECTION_WINDOWS` | Minimum windows before a weak QMON can be culled. | `5` |
| `QMON_EVOLUTION_MUTATION_RATE` | Mutation rate used when creating offspring genomes. | `0.04` |
| `QMON_HYDRATION_WINDOW_COUNT` | Number of historical windows replayed into newborns. | `30` |

## Troubleshooting

### The signal API is empty

`/api/signals/structured` returns an empty object plus trigger/regime arrays until snapshots arrive. This is expected on a cold start.

### The dashboard shows no QMONs

Delete `data/family-state.json` and restart if you want a clean bootstrap. The service seeds fresh populations when no stored family state exists.

### Diagnostics show order failures

The simulator is taker-only, but orders can still expire at market end or be rejected on slippage and minimum-notional checks. Use:

- `/api/qmons/diagnostics/overview`
- `/api/qmons/diagnostics/market?market=btc-5m`
- `/api/qmons/cpnl-log`

### `npm run standards:check` fails on managed files

This repository uses `@sha3/code-standards`. Managed AI contract files are part of the verification surface, so a missing managed file will fail standards even if application code is correct.

## AI Workflow

This repository is governed by the contract in `AGENTS.md` and `ai/contract.json`.

Operational rules for AI changes:

- keep the canonical signal surface at `calculateStructured()`
- keep QMON execution taker-only
- preserve the champion seat as a separate ledger from candidate paper evaluation
- update `src/index.ts`, `README.md`, `test/`, and HTTP docs together when contracts change
- avoid editing managed contract files unless the task is explicitly a standards update

Recommended validation flow for code changes:

```bash
npm run typecheck
npm run test
npm run check
```