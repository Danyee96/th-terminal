/**
 * TEMPLATE — copy this file to add a new market-data API
 * (Polygon, Alpaca, Twelve Data, Financial Modeling Prep, …).
 *
 * 1. Copy to e.g. src/providers/polygon.js and implement the methods below.
 * 2. Register it in src/providers/index.js.
 * 3. Set DATA_PROVIDER=polygon (and its API key) in .env.
 *
 * Every method should throw on failure; the market service handles retries
 * and falls back gracefully.
 */
import { getJSON } from "../lib/http.js";

export function createTemplateProvider({ apiKey } = {}) {
  return {
    id: "template",
    label: "My data provider",
    mode: "polling", // "polling" | "streaming" | "simulated"

    /** Daily bars, oldest first: [{ d: "YYYY-MM-DD", o, h, l, c, v }] */
    async history(sym, { years = 2 } = {}) {
      const json = await getJSON(`https://api.example.com/v1/bars/${sym}?years=${years}&apikey=${apiKey}`);
      return json.bars.map((b) => ({ d: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
    },

    /** Latest quotes for many symbols: [{ sym, price, prevClose?, open?, volume?, ts?, marketStatus? }] */
    async quotes(syms) {
      const json = await getJSON(`https://api.example.com/v1/quotes?symbols=${syms.join(",")}&apikey=${apiKey}`);
      return json.quotes.map((q) => ({ sym: q.symbol, price: q.last, prevClose: q.prevClose, open: q.open, volume: q.volume, ts: q.time }));
    },

    /** Market cap in $ billions, or null if unknown. Optional. */
    async marketCap(sym) {
      return null;
    },
  };
}
