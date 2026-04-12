# QMON v1

## TL;DR

QMON v1 is a preset-only Polymarket runtime with a small fixed catalog of QMONs per configured market. The active strategies are `late-trend-reverse`, `mid-window-cheap-trend-x2`, and `late-trend-band-entry`, each with independent paper history, champion eligibility, and optional real-seat mirroring.

## Why

The previous QMON stack was dominated by genetic evolution, large diagnostic payloads, and champion heuristics that made the product difficult to reason about. QMON v1 replaces that with a direct operating model:

- a small predefined strategy catalog per market
- one simple active rule
- one simple champion rule
- one reduced dashboard and API surface

## Main Capabilities

- builds 24 preset QMONs from the default `btc/eth/sol/xrp` x `5m/15m` universe
- computes structured market snapshots with current token prices and timing fields
- derives a simplified trend state from recent price momentum
- runs the `late-trend-reverse`, `mid-window-cheap-trend-x2`, and `late-trend-band-entry` paper strategies
- settles paper trades at market resolution
- marks a market champion only when recent 5-window paper PnL is positive
- mirrors the champion seat into a simplified real-seat ledger when mode is `real`
- serves a reduced dashboard and JSON API

## Installation

```bash
npm install
```

## Running Locally

```bash
npm start
```

Verification:

```bash
npm run check
```

## Usage

Start the runtime and open:

- `http://localhost:3000/`
- `http://localhost:3000/signals.html`

You can also consume the JSON payloads directly:

```bash
curl http://localhost:3000/api/qmons
curl http://localhost:3000/api/qmons/stats
curl http://localhost:3000/api/signals/structured
```

## Examples

Paper-only startup:

```bash
QMON_EXECUTION_MODE=paper npm start
```

Adjusted late-zone behavior:

```bash
QMON_LATE_ZONE_FRACTION=0.10 \
QMON_CHAMPION_WINDOW_COUNT=5 \
QMON_MIN_ENTRY_USD=1 \
QMON_MIN_ENTRY_SHARES=5 \
npm start
```

## Public API

This package currently does not expose a stable library API from `src/index.ts`.

The project is intended to run as an application service via `npm start`, while internal modules such as `ServiceRuntime`, `QmonEngine`, and `SignalEngine` remain implementation details inside `src/`.

### `ExecutionMode`

Union type: `paper | real`.

### `RuntimeExecutionStatus`

Runtime status payload exposing the current mode and per-market route summaries.

### `SignalEngine`

Builds the structured signal payload used by the runtime.

- `SignalEngine.createDefault()`
  - Creates the signal engine from `src/config.ts`.
- `calculateStructured(snapshots)`
  - Returns asset-level placeholders plus current window timing and token prices.

### `StructuredSignalResult`

Type representing the structured signal payload keyed by asset.

### `Snapshot`

Re-exported Polymarket snapshot type consumed by the signal engine and runtime.

### `RegimeEngine`

Classifies a simple market direction from recent momentum.

- `RegimeEngine.createDefault()`
  - Creates the simplified regime engine.
- `evaluate(structuredSignals)`
  - Returns current regime states and any direction-change events.
- `getCurrentStates()`
  - Returns the most recently computed regime state map.

### `RegimeResult`

Type representing the current regime state keyed by asset.

### `QmonPresetStrategyService`

Factory for the preset strategy catalog.

- `QmonPresetStrategyService.createDefault()`
  - Creates the preset strategy registry.
- `getDefinition()`
  - Returns the canonical baseline strategy definition.
- `getDefinitions()`
  - Returns the full preset strategy catalog.
- `createMarketQmon(market)`
  - Creates the canonical preset QMON for one market.

### `QmonChampionService`

Applies the simplified active/champion rule.

- `QmonChampionService.createDefault()`
  - Creates the champion selector.
- `refreshPopulation(population)`
  - Recomputes recent 5-window activity and assigns the champion role to the best eligible QMON.

### `QmonEngine`

Runs the preset-only QMON family.

- `QmonEngine.createDefault(assets, windows, initialFamilyState?)`
  - Creates the engine and optionally hydrates it from a persisted v1 family state.
- `getFamilyState()`
  - Returns the current family state.
- `replaceFamilyState(familyState)`
  - Replaces the in-memory family state after real-seat synchronization.
- `getStateSnapshotVersion()`
  - Returns the current mutation version.
- `consumeMutationState()`
  - Returns and clears pending persistence mutation flags.
- `evaluateAll(structuredSignals, regimes, evaluatedAt)`
  - Evaluates all market QMONs, settles expired paper positions, rolls completed windows, and refreshes champions.

### `QmonLiveExecutionService`

Mirrors the champion seat into the simplified real-seat ledger.

- `QmonLiveExecutionService.createDefault(minimumVenueShares)`
  - Creates the mirroring service.
- `syncFamilyState(familyState, executionMode, synchronizedAt)`
  - Returns the family state with updated `realSeat` summaries.
- `resolveMirroredShareCount(requestedShareCount, venueMinimumShares)`
  - Returns the larger of the requested and venue-minimum share counts.

### `QmonPersistenceService`

Stores and loads the v1 family state.

- `QmonPersistenceService.createDefault(dataDir)`
  - Persists to `qmon-v1-state.json` inside `dataDir`.
- `load()`
  - Loads a valid v1 family state or returns `null` for legacy payloads.
- `save(familyState)`
  - Saves the supplied family state and returns `true` on success.

### `MarketKey`

String-literal market identifier in the form `<asset>-<window>`.

### `Qmon`

Type describing one preset market QMON, including current trend, paper position, strategy state, and recent performance.

### `QmonFamilyState`

Type describing the persisted family state for all configured markets.

## HTTP API

### `GET /api/qmons`

Returns the reduced runtime payload:

- configured markets
- current trend
- current paper position
- last 5 paper windows
- recent summed PnL
- champion id or `null`
- real-seat summary

### `GET /api/qmons/stats`

Returns high-level runtime counters such as total markets, total QMONs, champion count, total PnL, and total trades.

### `GET /api/signals/structured`

Returns the latest structured signals, current regimes, and regime-change events.

## Configuration

Every top-level config key from `src/config.ts`:

| Key | Purpose | Default |
| --- | --- | --- |
| `RESPONSE_CONTENT_TYPE` | Default JSON content type. | `application/json` |
| `DEFAULT_PORT` | HTTP port used by `startServer()`. | `3000` |
| `SERVICE_NAME` | Runtime service identifier. | `@sha3/polymarket-quant` |
| `SNAPSHOT_INTERVAL_MS` | Snapshot polling cadence. | `500` |
| `SIGNAL_HORIZONS_SEC` | Signal horizons used by the simplified signal engine. | `30,120,300` |
| `SIGNAL_ASSETS` | Configured asset universe. | `btc,eth,sol,xrp` |
| `SIGNAL_WINDOWS` | Configured market windows. | `5m,15m` |
| `SIGNAL_EXCHANGES` | Exchange names retained in config for snapshot compatibility. | `binance,coinbase,kraken,okx` |
| `QMON_EXECUTION_MODE` | Mirroring mode: `paper` or `real`. | `paper` |
| `QMON_PERSIST_CHECKPOINT_MS` | Minimum delay between automatic saves. | `10000` |
| `QMON_LATE_ZONE_FRACTION` | Fraction of the window considered “late zone”. | `0.1` |
| `QMON_CHAMPION_WINDOW_COUNT` | Recent completed paper windows used for champion selection. | `5` |
| `QMON_MIN_ENTRY_USD` | Minimum order notional for paper or mirrored entries. | `1` |
| `QMON_MIN_ENTRY_SHARES` | Minimum share count for paper or mirrored entries. | `5` |

## Compatibility

- Node.js ESM service
- built and tested with the repo TypeScript toolchain
- breaking refactor relative to the legacy genetic QMON model
- legacy QMON persistence is intentionally ignored by v1

## Scripts

- `npm start` starts the live service
- `npm run build` builds `dist/`
- `npm run standards:check` runs the project standards verifier
- `npm run lint` runs Biome checks
- `npm run format:check` checks formatting
- `npm run typecheck` runs TypeScript without emit
- `npm run test` runs the test suite
- `npm run check` runs the full blocking gate

## Structure

- `src/app/` runtime bootstrap
- `src/http/` dashboard and JSON endpoints
- `src/qmon/` preset QMON engine, champion selection, persistence, and real-seat mirroring
- `src/regime/` simplified trend classification
- `src/signal/` simplified structured signal extraction
- `public/` dashboards
- `test/` behavior tests

## Troubleshooting

### No champion appears

The market QMON is champion-eligible only when its summed paper PnL over the last 5 completed windows is strictly positive.

### No trade appears

`late-trend-reverse` trades only when all of these are true:

- the market is inside the last 10% of the active window
- the trend flips from `UP` to `DOWN` or from `DOWN` to `UP`
- the QMON has not already triggered in that window
- current token pricing supports both the minimum USD and minimum share constraints

`mid-window-cheap-trend-x2` trades only when all of these are true:

- the market is at or beyond 50% of the active window
- the current trend is `UP` or `DOWN`
- the trend-aligned token costs `<= 0.20`
- the QMON has not already triggered in that window

`late-trend-band-entry` trades only when all of these are true:

- the market is at or beyond 75% of the active window
- the current trend is `UP` or `DOWN`
- the trend-aligned token costs between `0.60` and `0.80`
- the QMON has not already triggered in that window

### Real seat stays flat

The real seat mirrors only the champion. If the market has no champion or the champion has no open paper position, the mirrored real seat stays empty.

## AI Workflow

- Read `AGENTS.md`, `ai/contract.json`, and the relevant skill instructions before changing code.
- Keep the QMON system preset-first unless a new requirement explicitly reintroduces a different strategy model.
- Update tests, dashboard payloads, and README sections in the same pass whenever behavior changes.
- Do not edit managed files except when the task requires bringing the contract surface back into a passing state.
