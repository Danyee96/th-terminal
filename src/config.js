import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(+v) ? d : +v);

/** All runtime settings come from environment variables (see .env.example). */
export const config = {
  root,
  port: num(process.env.PORT, 3000),
  provider: (process.env.DATA_PROVIDER || "nasdaq").toLowerCase(),
  finnhubKey: process.env.FINNHUB_API_KEY || "",
  finnhubMaxSymbols: num(process.env.FINNHUB_MAX_SYMBOLS, 50),
  quotePollMs: Math.max(5000, num(process.env.QUOTE_POLL_MS, 15000)),
  historyYears: num(process.env.HISTORY_YEARS, 2),
  historyRefreshMin: num(process.env.HISTORY_REFRESH_MIN, 360),
  concurrency: num(process.env.FETCH_CONCURRENCY, 4),
  cacheDir: path.resolve(root, process.env.CACHE_DIR || "data/cache"),
  logLevel: process.env.LOG_LEVEL || "info",

  // crypto module
  crypto: process.env.CRYPTO_ENABLED !== "false",
  whaleTradeUsd: num(process.env.WHALE_TRADE_USD, 1_000_000),       // BTC & ETH single prints
  whaleTradeUsdAlts: num(process.env.WHALE_TRADE_USD_ALTS, 250_000), // other coins
  whaleSpotCoins: num(process.env.WHALE_STREAM_COINS, 10),           // how many top coins to watch trade-by-trade
  whaleBtc: num(process.env.WHALE_BTC_ONCHAIN, 100),                // on-chain BTC transfer size
  liqWhaleUsd: num(process.env.LIQUIDATION_WHALE_USD, 100_000),     // liquidations shown in the whale feed
};
