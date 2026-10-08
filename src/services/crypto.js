/**
 * Crypto market service — the second module of the terminal.
 *
 *  Prices        Binance spot: 2y daily candles + live mini-ticker stream (24/7)
 *  Market data   CoinGecko: market cap, rank, supply, ATH, global market, trending
 *  Derivatives   Binance futures: funding, open interest (7d), long/short ratio
 *                (Bybit fallback for funding/OI)
 *  Whales        Binance spot + Bybit perps trade streams (large prints),
 *                Bybit liquidations, large on-chain BTC transactions
 *  Research      Fear & Greed, DeFiLlama (TVL, stablecoins, DEX volume), GeckoTerminal trending pools
 *
 * Emits: "quotes", "history", "meta", "deriv", "whales", "research".
 */
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { COINS } from "../crypto/universe.js";
import { computeStock, DEFAULT_CFG } from "../shared/indicators.js";
import { mapLimit } from "../lib/http.js";
import { packBars } from "./market.js";
import * as binance from "../providers/crypto/binance.js";
import * as bybit from "../providers/crypto/bybit.js";
import * as gecko from "../providers/crypto/coingecko.js";
import * as research from "../providers/crypto/research.js";

const utcToday = () => new Date().toISOString().slice(0, 10);
const DAY = 24 * 3600_000;
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

export class CryptoMarket extends EventEmitter {
  constructor({ config, log }) {
    super();
    this.config = config;
    this.log = log;
    this.coins = new Map();
    this.dirty = new Set();
    this.whales = [];        // large trades, liquidations and on-chain moves (newest first)
    this.pendingWhales = [];
    this.liqs = [];          // every liquidation in the last 24h, for totals
    this.seenTx = new Set();
    this.version = 0;
    this.research = { global: null, fng: null, defi: null, stables: null, dex: null, trending: null, pools: null };
    this.status = {
      provider: { id: "binance", label: "Binance + CoinGecko", mode: "streaming" },
      session: "open",
      pollMs: 1000,
      loaded: 0,
      total: COINS.length,
      unavailable: [],
      ready: false,
      lastQuoteAt: null,
      streams: { spot: false, bybit: false },
      derivatives: { source: null, updatedAt: null, error: null },
      research: {},
      whaleMinUsd: { majors: config.whaleTradeUsd, alts: config.whaleTradeUsdAlts, onchainBtc: config.whaleBtc, liquidation: config.liqWhaleUsd },
    };
    this.ready = new Promise((r) => (this._resolveReady = r));
  }

  /* ------------------------------ startup ------------------------------ */

  async start() {
    await fs.mkdir(this.config.cacheDir, { recursive: true });
    for (const c of COINS) this.coins.set(c.tk, { ...c, bars: [], source: "binance", quote: null, deriv: { funding: null }, capB: 0, shares: null });

    this.log.info(`Loading crypto history for ${this.coins.size} coins from Binance…`);
    await mapLimit([...this.coins.values()], 6, async (c) => {
      const ok = await this.loadHistory(c);
      if (!ok) { this.coins.delete(c.tk); this.status.unavailable.push(c.tk); }
      this.status.loaded++;
    });
    await this.refreshMarkets().catch((e) => this.log.warn(`CoinGecko markets: ${e.message}`));
    this.status.ready = true;
    this._resolveReady();
    this.log.info(`Crypto ready (${this.coins.size} coins${this.status.unavailable.length ? `, unavailable: ${this.status.unavailable.join(", ")}` : ""})`);

    this.startSpotStream();
    this.startDerivatives().catch((e) => this.log.warn(`Derivatives start: ${e.message}`));
    this.every(3 * 60_000, () => this.refreshMarkets(), "markets", false);
    this.every(30 * 60_000, () => this.refreshRecentCandles(), "candles", false);
    this.every(30_000, () => this.pollOnchainWhales(), "onchain");
    this.every(5 * 60_000, async () => (this.research.global = await gecko.global()), "global", true, 20_000);
    this.every(10 * 60_000, async () => (this.research.trending = await gecko.trending()), "trending", true, 40_000);
    this.every(30 * 60_000, async () => (this.research.fng = await research.fearGreed()), "fng");
    this.every(30 * 60_000, async () => (this.research.defi = await research.defiChains()), "defi");
    this.every(60 * 60_000, async () => (this.research.stables = await research.stablecoins()), "stables");
    this.every(60 * 60_000, async () => (this.research.dex = await research.dexVolume()), "dex");
    this.every(3 * 60_000, async () => (this.research.pools = await research.trendingPools()), "pools");
    setInterval(() => this.flush(), 1000);
  }

  /** Run `fn` now (optionally) and then every `ms`, logging failures without crashing. */
  every(ms, fn, name, now = true, delay = 0) {
    const run = async () => {
      try {
        await fn();
        this.status.research[name] = { updatedAt: Date.now() };
        if (this.research[name] !== undefined) this.emit("research", { key: name, data: this.research[name] });
      } catch (e) {
        this.status.research[name] = { ...this.status.research[name], error: e.message };
        this.log.warn(`Crypto ${name}: ${e.message}`);
      }
    };
    // CoinGecko's free tier allows only a few calls per minute, so start-up calls are staggered
    setTimeout(() => { if (now) run(); setInterval(run, ms); }, delay);
  }

  stop() {
    this.stopped = true;
    this.spotWs?.close();
    this.bybit?.close();
  }

  /* ------------------------------ history ------------------------------ */

  async loadHistory(c) {
    const file = path.join(this.config.cacheDir, `crypto_${c.tk}.json`);
    try {
      const j = JSON.parse(await fs.readFile(file, "utf8"));
      if (Date.now() - j.fetchedAt < 60 * 60_000 && j.bars?.length > 60) { c.bars = j.bars; return true; }
    } catch { /* no cache */ }
    try {
      const bars = await binance.dailyCandles(c.pair, 730);
      if (bars.length < 60) throw new Error(`only ${bars.length} candles`);
      c.bars = bars;
      await fs.writeFile(file, JSON.stringify({ fetchedAt: Date.now(), bars }));
      return true;
    } catch (e) {
      this.log.warn(`Crypto history failed for ${c.tk}: ${e.message}`);
      return false;
    }
  }

  /** Replace the last few daily candles with Binance's official values. */
  async refreshRecentCandles() {
    await mapLimit([...this.coins.values()], 4, async (c) => {
      const recent = await binance.dailyCandles(c.pair, 3);
      for (const b of recent) {
        const i = c.bars.findIndex((x) => x.d === b.d);
        if (i >= 0) c.bars[i] = b; else if (b.d > c.bars.at(-1).d) c.bars.push(b);
      }
      this.emit("history", { tk: c.tk, bars: packBars(c.bars) });
    });
  }

  /* ---------------------------- market data ---------------------------- */

  async refreshMarkets() {
    const rows = await gecko.markets([...this.coins.values()].map((c) => c.cgId));
    const by = new Map(rows.map((r) => [r.cgId, r]));
    for (const c of this.coins.values()) {
      const m = by.get(c.cgId);
      if (!m) continue;
      Object.assign(c, { image: m.image, rank: m.rank, capB: m.capB, fdvB: m.fdvB, volB: m.volB, circ: m.circ, maxSupply: m.max, totalSupply: m.total, ath: m.ath, athChg: m.athChg });
      c.shares = m.circ || null; // circulating supply → live market cap = supply × price
    }
    this.version++;
    this.emit("meta", [...this.coins.values()].map((c) => this.meta(c)));
  }

  meta(c) {
    return { tk: c.tk, image: c.image, rank: c.rank, capB: c.capB, fdvB: c.fdvB, volB: c.volB, circ: c.circ, maxSupply: c.maxSupply, totalSupply: c.totalSupply, ath: c.ath, athChg: c.athChg, shares: c.shares };
  }

  /* ------------------------------- prices ------------------------------ */

  startSpotStream() {
    const all = [...this.coins.values()];
    const whaleCoins = all.slice(0, this.config.whaleSpotCoins).map((c) => c.pair.toLowerCase());
    const streams = [...all.map((c) => `${c.pair.toLowerCase()}@miniTicker`), ...whaleCoins.map((p) => `${p}@aggTrade`)];
    const byPair = new Map(all.map((c) => [c.pair, c]));
    let retry = 0;

    const connect = () => {
      const ws = new WebSocket(binance.SPOT_STREAM + streams.join("/"));
      this.spotWs = ws;
      ws.on("open", () => { retry = 0; this.status.streams.spot = true; this.log.info(`Binance spot stream connected (${streams.length} streams)`); });
      ws.on("message", (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        const d = m.data;
        if (!d) return;
        const c = byPair.get(d.s);
        if (!c) return;
        if (d.e === "24hrMiniTicker") this.applyPrice(c, +d.c, d.E);
        else if (d.e === "aggTrade") {
          const usd = +d.p * +d.q;
          if (usd >= this.whaleMin(c.tk)) this.addWhale({ kind: "trade", sym: c.tk, side: d.m ? "sell" : "buy", usd, price: +d.p, ts: d.T, venue: "Binance spot" });
        }
      });
      ws.on("close", () => {
        this.status.streams.spot = false;
        if (this.stopped) return;
        setTimeout(connect, Math.min(60000, 1000 * 2 ** retry++));
      });
      ws.on("error", (e) => this.log.warn(`Binance spot stream: ${e.message}`));
    };
    connect();

    // REST fallback while the stream is down
    setInterval(async () => {
      if (this.status.streams.spot) return;
      try {
        for (const p of await binance.spotPrices([...byPair.keys()])) { const c = byPair.get(p.pair); if (c) this.applyPrice(c, p.price, Date.now()); }
      } catch (e) { this.log.warn(`Binance price poll: ${e.message}`); }
    }, 10_000);
  }

  whaleMin(tk) {
    return tk === "BTC" || tk === "ETH" ? this.config.whaleTradeUsd : this.config.whaleTradeUsdAlts;
  }

  /** Crypto trades 24/7: update today's UTC candle, or open a new one at midnight UTC. */
  applyPrice(c, price, ts) {
    if (!(price > 0) || !c.bars.length) return;
    const today = utcToday(), last = c.bars.at(-1);
    if (last.d === today) { last.c = price; last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); }
    else if (last.d < today) c.bars.push({ d: today, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 });
    c.quote = { price, ts: ts || Date.now(), session: "open" };
    this.status.lastQuoteAt = Date.now();
    this.dirty.add(c.tk);
  }

  /* ---------------------------- derivatives ---------------------------- */

  async startDerivatives() {
    const tks = [...this.coins.keys()];
    try {
      const all = await binance.premiumIndexAll();
      const set = new Set(all.map((x) => x.symbol));
      for (const c of this.coins.values()) c.perp = [`${c.tk}USDT`, `1000${c.tk}USDT`].find((s) => set.has(s)) || null;
    } catch (e) { this.log.warn(`Binance futures unavailable (${e.message}); using Bybit for funding/OI`); }
    try { this.bybitSyms = await bybit.linearSymbols(tks); } catch (e) { this.bybitSyms = {}; this.log.warn(`Bybit instruments: ${e.message}`); }

    this.every(60_000, () => this.refreshFunding(), "funding");
    this.every(5 * 60_000, () => this.refreshOpenInterest(), "oi");

    if (Object.keys(this.bybitSyms).length) {
      this.bybit = bybit.createBybitStream({
        symbols: this.bybitSyms,
        tradeSymbols: tks.slice(0, this.config.whaleSpotCoins),
        log: this.log,
        onState: (up) => (this.status.streams.bybit = up),
        onTrade: (t) => { if (t.usd >= this.whaleMin(t.sym)) this.addWhale({ kind: "trade", ...t }); },
        onLiquidation: (l) => this.addLiquidation(l),
      });
    }
  }

  async refreshFunding() {
    try {
      const rows = await binance.premiumIndexAll();
      const by = new Map(rows.map((r) => [r.symbol, r]));
      for (const c of this.coins.values()) {
        const r = c.perp && by.get(c.perp);
        if (r) Object.assign(c.deriv, { funding: r.funding, nextFunding: r.nextFunding, mark: r.mark });
      }
      this.status.derivatives.source = "Binance futures";
    } catch (e) {
      const rows = await bybit.linearTickers();
      const by = new Map(rows.map((r) => [r.symbol, r]));
      for (const c of this.coins.values()) {
        const r = this.bybitSyms?.[c.tk] && by.get(this.bybitSyms[c.tk]);
        if (r) Object.assign(c.deriv, { funding: r.funding, nextFunding: r.nextFunding, oiUsd: c.deriv.oiUsd ?? r.oiUsd });
      }
      this.status.derivatives.source = "Bybit (Binance futures unavailable)";
    }
    this.status.derivatives.updatedAt = Date.now();
    this.emitDeriv();
  }

  async refreshOpenInterest() {
    const perps = [...this.coins.values()].filter((c) => c.perp);
    await mapLimit(perps, 4, async (c) => {
      const [oi, ls] = await Promise.all([
        binance.openInterestHistory(c.perp).catch(() => null),
        binance.longShortRatio(c.perp).catch(() => null),
      ]);
      if (oi?.length) {
        const last = oi.at(-1).usd, d1 = oi.at(-7)?.usd, d7 = oi[0].usd;
        Object.assign(c.deriv, { oiUsd: last, oiChg24h: d1 ? (last / d1 - 1) * 100 : null, oiChg7d: d7 ? (last / d7 - 1) * 100 : null, oiSeries: oi.map((x) => Math.round(x.usd)) });
      }
      if (ls) c.deriv.ls = ls;
    });
    this.emitDeriv();
  }

  addLiquidation(l) {
    this.liqs.push(l);
    if (l.usd >= this.config.liqWhaleUsd) this.addWhale({ kind: "liquidation", ...l });
  }

  liqTotals() {
    const cut = Date.now() - DAY;
    if (this.liqs.length && this.liqs[0].ts < cut) this.liqs = this.liqs.filter((l) => l.ts >= cut);
    const out = {};
    for (const l of this.liqs) {
      const o = (out[l.sym] ||= { long: 0, short: 0, n: 0 });
      o[l.side] += l.usd; o.n++;
    }
    return out;
  }

  derivPayload() {
    const liq = this.liqTotals();
    return [...this.coins.values()].map((c) => ({ tk: c.tk, ...c.deriv, perp: c.perp || this.bybitSyms?.[c.tk] || null, liq: liq[c.tk] || { long: 0, short: 0, n: 0 } }));
  }

  emitDeriv() {
    this.version++;
    this.emit("deriv", { coins: this.derivPayload(), status: this.status.derivatives, liqSince: this.liqs[0]?.ts || Date.now() });
  }

  /* ------------------------------- whales ------------------------------ */

  addWhale(w) {
    const ev = { id: `${w.kind}-${w.sym}-${w.ts}-${Math.round(w.usd)}`, ...w, usd: Math.round(w.usd) };
    this.whales.unshift(ev);
    if (this.whales.length > 400) this.whales.length = 400;
    this.pendingWhales.push(ev);
  }

  async pollOnchainWhales() {
    const btc = this.coins.get("BTC");
    const price = btc?.bars.at(-1)?.c;
    if (!price) return;
    const txs = await research.btcWhaleTxs(this.config.whaleBtc);
    for (const t of txs) {
      if (this.seenTx.has(t.hash)) continue;
      this.seenTx.add(t.hash);
      this.addWhale({ kind: "onchain", sym: "BTC", side: "transfer", usd: t.btc * price, amount: t.btc, ts: Math.min(t.ts, Date.now()), venue: "Bitcoin network", link: `https://mempool.space/tx/${t.hash}` });
    }
    if (this.seenTx.size > 5000) this.seenTx = new Set([...this.seenTx].slice(-2000));
  }

  /* ------------------------------- output ------------------------------ */

  flush() {
    if (this.dirty.size) {
      const batch = [...this.dirty].map((tk) => {
        const c = this.coins.get(tk), b = c.bars.at(-1);
        return { tk, quote: c.quote, bar: { d: b.d, o: r4(b.o), h: r4(b.h), l: r4(b.l), c: r4(b.c), v: b.v } };
      });
      this.dirty.clear();
      this.version++;
      this.emit("quotes", batch);
    }
    if (this.pendingWhales.length) {
      this.emit("whales", this.pendingWhales.splice(0));
    }
  }

  bootstrap() {
    return {
      status: this.status,
      coins: [...this.coins.values()].map((c) => ({
        tk: c.tk, name: c.name, sector: c.sector, themes: c.themes, source: c.source, quote: c.quote, cgId: c.cgId, pair: c.pair,
        ...this.meta(c), bars: packBars(c.bars),
      })),
      deriv: this.derivPayload(),
      liqSince: this.liqs[0]?.ts || Date.now(),
      whales: this.whales.slice(0, 200),
      research: this.research,
    };
  }

  computed() {
    if (this._computedAt !== this.version) {
      for (const c of this.coins.values()) if (c.bars.length) computeStock(c, DEFAULT_CFG);
      this._computedAt = this.version;
    }
    return [...this.coins.values()].filter((c) => c.bars.length);
  }
}
