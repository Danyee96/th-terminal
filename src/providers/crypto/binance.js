/**
 * Binance public market data — free, no API key.
 * Spot: daily candles + live prices. USDⓈ-M futures: funding, open interest, long/short ratio.
 * Binance blocks some regions (including US-hosted servers). If you deploy in
 * the US, host in an EU/Asia region or swap these calls for another exchange.
 */
import { getJSON } from "../../lib/http.js";

const SPOT = "https://api.binance.com";
const FUT = "https://fapi.binance.com";
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function dailyCandles(pair, limit = 730) {
  const rows = await getJSON(`${SPOT}/api/v3/klines?symbol=${pair}&interval=1d&limit=${limit}`);
  return rows.map((k) => ({ d: utcDay(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] })); // v = quote volume (USDT)
}

export async function spotPrices(pairs) {
  const rows = await getJSON(`${SPOT}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(pairs))}`);
  return rows.map((r) => ({ pair: r.symbol, price: +r.price }));
}

/** Funding + mark price for every perpetual in one call. */
export async function premiumIndexAll() {
  const rows = await getJSON(`${FUT}/fapi/v1/premiumIndex`);
  return rows.map((r) => ({ symbol: r.symbol, funding: +r.lastFundingRate, mark: +r.markPrice, nextFunding: +r.nextFundingTime }));
}

/** Open interest (USD) every 4h for the last 7 days, oldest first. */
export async function openInterestHistory(symbol) {
  const rows = await getJSON(`${FUT}/futures/data/openInterestHist?symbol=${symbol}&period=4h&limit=43`, { retries: 1 });
  return rows.map((r) => ({ t: +r.timestamp, usd: +r.sumOpenInterestValue }));
}

/** Share of accounts long vs short (last hour). */
export async function longShortRatio(symbol) {
  const rows = await getJSON(`${FUT}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`, { retries: 1 });
  const r = rows.at(-1);
  return r ? { ratio: +r.longShortRatio, long: +r.longAccount, short: +r.shortAccount } : null;
}

export const SPOT_STREAM = "wss://stream.binance.com:9443/stream?streams=";
