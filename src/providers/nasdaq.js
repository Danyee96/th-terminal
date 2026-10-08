/**
 * Nasdaq public quote API — free, no API key.
 * - history():   daily OHLCV, ~2 years, from /api/quote/{sym}/historical
 * - quotes():    batch last-sale quotes (polled), from /api/quote/watchlist
 * - marketCap(): from /api/quote/{sym}/summary
 *
 * This is the public API behind nasdaq.com. It is not an official developer
 * product: fine for prototyping, but use a licensed provider (Polygon, Alpaca,
 * Finnhub paid, etc.) before charging users for the data.
 */
import { getJSON, chunk } from "../lib/http.js";

const BASE = "https://api.nasdaq.com/api";
const num = (s) => (s == null ? NaN : typeof s === "number" ? s : parseFloat(String(s).replace(/[$,%+\s]/g, "")));
const ymd = (d) => d.toISOString().slice(0, 10);

function findKey(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

export function createNasdaqProvider() {
  return {
    id: "nasdaq",
    label: "Nasdaq public API",
    mode: "polling", // prices are polled, not streamed

    async history(sym, { years = 2 } = {}) {
      const to = new Date(), from = new Date();
      from.setFullYear(to.getFullYear() - years);
      const url = `${BASE}/quote/${encodeURIComponent(sym)}/historical?assetclass=stocks&fromdate=${ymd(from)}&todate=${ymd(to)}&limit=9999`;
      const j = await getJSON(url);
      const rows = j?.data?.tradesTable?.rows;
      if (!rows?.length) throw new Error(`no history returned for ${sym}`);
      return rows
        .map((r) => {
          const [m, d, y] = r.date.split("/");
          const c = num(r.close), o = num(r.open), h = num(r.high), l = num(r.low);
          return { d: `${y}-${m}-${d}`, o: o > 0 ? o : c, h: h > 0 ? h : c, l: l > 0 ? l : c, c, v: num(r.volume) || 0 };
        })
        .filter((b) => b.c > 0)
        .reverse(); // oldest first
    },

    async quotes(syms) {
      const out = [];
      for (const group of chunk(syms, 20)) {
        const qs = group.map((s) => `symbol=${encodeURIComponent(s.toLowerCase())}%7cstocks`).join("&");
        const j = await getJSON(`${BASE}/quote/watchlist?${qs}`, { retries: 1 });
        for (const r of j?.data || []) {
          out.push({
            sym: String(r.symbol).toUpperCase().replace("/", "."),
            price: num(r.lastSalePrice),
            prevClose: num(r.previousClosePrice),
            open: num(r.openingPrice),
            volume: num(r.volume),
            ts: Date.parse(r.lastTradeTimestampDateTime) || Date.now(),
            marketStatus: r.marketStatus || null,
          });
        }
      }
      return out;
    },

    async marketCap(sym) {
      const j = await getJSON(`${BASE}/quote/${encodeURIComponent(sym)}/summary?assetclass=stocks`, { retries: 1 });
      const v = num(findKey(j, "MarketCap")?.value);
      return v > 0 ? v / 1e9 : null; // $ billions
    },
  };
}
