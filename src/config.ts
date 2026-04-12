import dotenv from "dotenv";

dotenv.config();

const ENV = process.env;
const SIGNAL_ASSETS = ["btc", "eth", "sol", "xrp"] as const;
const SIGNAL_WINDOWS = ["5m", "15m"] as const;
const QMON_EXECUTION_MODE = ENV.QMON_EXECUTION_MODE === "real" ? "real" : "paper";

const config = {
  RESPONSE_CONTENT_TYPE: ENV.RESPONSE_CONTENT_TYPE || "application/json",
  DEFAULT_PORT: Number(ENV.PORT || 3000),
  SERVICE_NAME: ENV.SERVICE_NAME || "@sha3/polymarket-quant",
  SNAPSHOT_INTERVAL_MS: Number(ENV.SNAPSHOT_INTERVAL_MS || 500),
  SIGNAL_HORIZONS_SEC: [30, 120, 300] as readonly number[],
  SIGNAL_ASSETS,
  SIGNAL_WINDOWS,
  SIGNAL_EXCHANGES: ["binance", "coinbase", "kraken", "okx"] as readonly string[],
  QMON_EXECUTION_MODE,
  QMON_PERSIST_CHECKPOINT_MS: Number(ENV.QMON_PERSIST_CHECKPOINT_MS || 10_000),
  QMON_LATE_ZONE_FRACTION: Number(ENV.QMON_LATE_ZONE_FRACTION || 0.1),
  QMON_CHAMPION_WINDOW_COUNT: Number(ENV.QMON_CHAMPION_WINDOW_COUNT || 5),
  QMON_MIN_ENTRY_USD: Number(ENV.QMON_MIN_ENTRY_USD || 1),
  QMON_MIN_ENTRY_SHARES: Number(ENV.QMON_MIN_ENTRY_SHARES || 5),
} as const;

export default config;
