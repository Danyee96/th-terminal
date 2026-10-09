/**
 * Market service — owns all price data.
 *  - loads ~2 years of daily history per stock (cached on disk)
 *  - polls the provider for live quotes and keeps today's candle current
 *  - optionally merges a Finnhub real-time trade stream
 *  - emits "quotes", "history", "meta" and "status" events for the websocket layer
 */
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { UNIVERSE } from "../universe.js";
import { validBars } from "../lib/bars.js";
import { computeStock, DEFAULT_CFG } from "../shared/indicators.js";
import { mapLimit, sleep } from "../lib/http.js";
import { createFinnhubStream } from "../providers/finnhub.js";

const ET = "America/New_York";
export const etDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function clockSession(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]));
  if (p.weekday === "Sat" || p.weekday === "Sun") return "closed";
  const m = (+p.hour % 24) * 60 + +p.minute;
  return m >= 570 && m < 960 ? "open" : m >= 240 && m < 570 ? "pre" : m >= 960 && m < 1200 ? "post" : "closed";
}

function sessionFrom(status) {
  if (!status) return clockSession();
  const s = status.toLowerCase();
  if (s.includes("pre")) return "pre";
  if (s.includes("after")) return "post";
  if (s.includes("closed")) return "closed";
  if (s.includes("open")) return "open";
  return clockSession();
}

const round = (v) => (Number.isFinite(v) ? Math.round(v * 1e12) / 1e12 : v);
const safeName = (tk) => tk.replace(/[^A-Z0-9]/gi, "_");

export class Market extends EventEmitter {
  constructor({ provider, config, log }) {
    super();
    this.provider = provider;
    this.config = config;
    this.log = log;
    this.stocks = new Map();
    this.dirty = new Set();
    this.version = 0;
    this.status = {
      provider: { id: provider.id, label: provider.label, mode: provider.mode },
      finnhub: { enabled: Boolean(config.finnhubKey), connected: false, symbols: 0, lastTradeAt: null },
      marketStatus: null,
      session: provider.alwaysOpen ? "open" : clockSession(),
      lastQuoteAt: null,
      quoteError: null,
      pollMs: config.quotePollMs,
      loaded: 0,
      total: UNIVERSE.length,
      unavailable: [],
      historyErrors: {},
      ready: false,
      startedAt: Date.now(),
    };
    this.ready = new Promise((resolve) => (this._resolveReady = resolve));
  }

  /* ------------------------------ startup ------------------------------ */

  async start() {
    await fs.mkdir(this.config.cacheDir, { recursive: true });
    for (const u of UNIVERSE) {
      this.stocks.set(u.tk, { ...u, capB: 0, shares: null, bars: [], source: "pending", quote: null });
    }
    const caps = await this.readCapsCache();

    this.log.info(`Loading history for ${this.stocks.size} stocks from ${this.provider.label}…`);
    await mapLimit([...this.stocks.values()], this.config.concurrency, async (s) => {
      await this.loadHistory(s, { useCache: true });
      if (caps[s.tk] && s.bars.length) this.setCap(s, caps[s.tk]);
      this.status.loaded++;
    });
    this.status.ready = true;
    this._resolveReady();
    this.log.info(`History ready (${this.stocks.size - this.status.unavailable.length} real histories, ${this.status.unavailable.length} unavailable)`);

    this.loadMarketCaps(caps).catch((e) => this.log.warn(`Market caps: ${e.message}`));
    this.pollQuotes();
    if (this.config.finnhubKey) this.startFinnhub();
    setInterval(() => this.flush(), 1000);
    setInterval(() => this.refreshHistories(), this.config.historyRefreshMin * 60_000);
    setInterval(() => this.tickSession(), 30_000);
    setInterval(() => this.retryUnavailable(), 60_000);
  }

  stop() {
    this.stopped = true;
    this.finnhub?.close();
  }

  /* ------------------------------ history ------------------------------ */

  async loadHistory(s, { useCache }) {
    const file = path.join(this.config.cacheDir, `${safeName(s.tk)}.json`);
    let cached = null;
    if (useCache) {
      try {
        const j = JSON.parse(await fs.readFile(file, "utf8"));
        j.bars=validBars(j.bars);
        if(j.source === this.provider.id && j.source !== "simulated" && j.bars?.length > 60) cached=j;
        const fresh = Date.now() - j.fetchedAt < this.config.historyRefreshMin * 60_000;
        if (fresh && j.source === this.provider.id && j.bars?.length > 60) {
          s.bars = j.bars; s.source = j.source; s.histAt = j.fetchedAt; s.historyStale=false;
          return true;
        }
      } catch { /* no cache yet */ }
    }
    try {
      const bars = validBars(await this.provider.history(s.tk, { years: this.config.historyYears }));
      if (bars.length < 60) throw new Error(`only ${bars.length} bars`);
      // keep today's live candle if the provider's history doesn't include it yet
      const live = s.bars.at(-1);
      if (live && live.d > bars.at(-1).d) bars.push(live);
      s.bars = bars; s.source = this.provider.id; s.histAt = Date.now(); s.historyStale=false;
      this.status.unavailable = this.status.unavailable.filter(t => t !== s.tk);
      delete this.status.historyErrors[s.tk];
      this.version++;
      await fs.writeFile(file, JSON.stringify({ fetchedAt: s.histAt, source: s.source, bars }));
      return true;
    } catch (e) {
      this.log.warn(`History failed for ${s.tk}: ${e.message}`);
      this.status.historyErrors[s.tk]=e.message;
      if(!s.bars.length && cached){s.bars=cached.bars;s.source=cached.source;s.histAt=cached.fetchedAt;}
      s.historyStale=true;
      if(s.bars.length)this.status.unavailable=this.status.unavailable.filter(t=>t!==s.tk);
      if(!s.bars.length){s.source="unavailable";if(!this.status.unavailable.includes(s.tk))this.status.unavailable.push(s.tk);}
      return false;
    }
  }

  async refreshHistories() {
    this.log.info("Refreshing daily history…");
    await mapLimit([...this.stocks.values()], 2, async (s) => {
      if (await this.loadHistory(s, { useCache: false })) this.emit("history", { tk: s.tk, bars: packBars(s.bars) });
    });
  }

  async retryUnavailable(){
    if(this.stopped||this.retrying)return;this.retrying=true;
    try{await mapLimit([...this.stocks.values()].filter(s=>!s.bars.length),2,async s=>{if(await this.loadHistory(s,{useCache:false}))this.emit("history",{tk:s.tk,bars:packBars(s.bars)});});}finally{this.retrying=false;}
  }

  /* ---------------------------- market caps ---------------------------- */

  setCap(s, capB) {
    s.capB = capB;
    s.shares = (capB * 1e9) / s.bars.at(-1).c; // shares outstanding, so cap follows price
  }

  async readCapsCache() {
    try {
      const j = JSON.parse(await fs.readFile(path.join(this.config.cacheDir, "_caps.json"), "utf8"));
      return Date.now() - j.fetchedAt < 24 * 3600_000 ? j.caps : {};
    } catch { return {}; }
  }

  async loadMarketCaps(cached) {
    if (!this.provider.marketCap) return;
    const missing = [...this.stocks.values()].filter((s) => !cached[s.tk] && s.bars.length > 0);
    if (!missing.length) return;
    const caps = { ...cached };
    await mapLimit(missing, 3, async (s) => {
      const v = await this.provider.marketCap(s.tk);
      if (v) { caps[s.tk] = v; this.setCap(s, v); }
    });
    await fs.writeFile(path.join(this.config.cacheDir, "_caps.json"), JSON.stringify({ fetchedAt: Date.now(), caps }));
    this.version++;
    this.emit("meta", [...this.stocks.values()].map((s) => ({ tk: s.tk, capB: s.capB, shares: s.shares })));
    this.log.info(`Market caps loaded for ${Object.keys(caps).length} stocks`);
  }

  /* ------------------------------- quotes ------------------------------ */

  async pollQuotes() {
    const syms = [...this.stocks.keys()];
    while (!this.stopped) {
      try {
        const quotes = (await this.provider.quotes(syms)).filter(q => Number.isFinite(q.price) && q.price > 0);
        if(!quotes.length)throw new Error("Provider returned no valid quotes.");
        const ms = quotes.find((q) => q.marketStatus)?.marketStatus ?? null;
        if (ms) this.status.marketStatus = ms;
        this.status.session = this.provider.alwaysOpen ? "open" : sessionFrom(ms);
        for (const q of quotes) {
          const s = this.stocks.get(q.sym);
          if (s && q.price > 0) this.applyPrice(s, q);
        }
        this.status.lastQuoteAt = Date.now();
        this.status.quoteError = null;
      } catch (e) {
        this.status.quoteError = e.message;
        this.log.warn(`Quote poll failed: ${e.message}`);
      }
      await sleep(this.config.quotePollMs);
    }
  }

  /** Update a stock's quote and, during regular hours, today's candle. */
  applyPrice(s, q) {
    if(!s.bars.length || (s.quote?.ts && q.ts && q.ts < s.quote.ts))return;
    s.quote = {
      price: q.price,
      prevClose: Number.isFinite(q.prevClose) ? q.prevClose : s.quote?.prevClose,
      volume: Number.isFinite(q.volume) ? q.volume : s.quote?.volume,
      ts: q.ts || null,
      receivedAt: Date.now(),
      session: this.status.session,
    };
    // Daily indicators follow regular-session candles; extended hours stay in the quote.
    const live = this.provider.alwaysOpen || (this.status.session === "open" && s.bars.length > 0);
    if (live && s.bars.length) {
      const today = this.provider.alwaysOpen ? s.bars.at(-1).d : etDate();
      const last = s.bars.at(-1);
      if (last.d === today) {
        last.c = q.price; last.h = Math.max(last.h, q.price); last.l = Math.min(last.l, q.price);
        if (Number.isFinite(q.volume) && q.volume > 0) last.v = q.volume;
      } else if (last.d < today) {
        s.bars.push({ d: today, o: q.open > 0 ? q.open : q.price, h: Math.max(q.open || q.price,q.price), l: Math.min(q.open || q.price,q.price), c: q.price, v: q.volume > 0 ? q.volume : 0 });
      }
    }
    this.dirty.add(s.tk);
  }

  startFinnhub() {
    const symbols = [...this.stocks.values()].sort((a, b) => b.capB - a.capB).slice(0, this.config.finnhubMaxSymbols).map((s) => s.tk);
    this.status.finnhub.symbols = symbols.length;
    this.finnhub = createFinnhubStream({
      key: this.config.finnhubKey,
      symbols,
      log: this.log,
      onState: (up) => (this.status.finnhub.connected = up),
      onTrade: ({ sym, price, ts }) => {
        const s = this.stocks.get(sym);
        if (!s || !(price > 0)) return;
        this.status.finnhub.lastTradeAt = Date.now();
        this.status.lastQuoteAt = Date.now();
        this.applyPrice(s, { price, ts });
      },
    });
  }

  tickSession() {
    if (this.provider.alwaysOpen) return;
    // between polls, keep the session label current from the clock
    if (!this.status.lastQuoteAt || Date.now() - this.status.lastQuoteAt > 120_000) this.status.session = clockSession();
  }

  /** Send everything that changed in the last second as one batch. */
  flush() {
    if (!this.dirty.size) return;
    const batch = [...this.dirty].map((tk) => {
      const s = this.stocks.get(tk), b = s.bars.at(-1);
      return { tk, quote: s.quote, bar: { d: b.d, o: round(b.o), h: round(b.h), l: round(b.l), c: round(b.c), v: b.v } };
    });
    this.dirty.clear();
    this.version++;
    this.emit("quotes", batch);
  }

  /* ------------------------------ queries ------------------------------ */

  bootstrap() {
    return {
      status: this.status,
      stocks: [...this.stocks.values()].filter(s=>s.bars.length).map((s) => ({
        tk: s.tk, name: s.name, sector: s.sector, themes: s.themes,
        capB: s.capB, shares: s.shares, source: s.source, quote: s.quote, historyStale: !!s.historyStale, historyUpdatedAt: s.histAt,
        bars: packBars(s.bars),
      })),
    };
  }

  /** Indicator snapshot (server-side, default thresholds) — used by the REST API. */
  computed() {
    if (this._computedAt !== this.version) {
      for (const s of this.stocks.values()) if (s.bars.length) computeStock(s, DEFAULT_CFG);
      this._computedAt = this.version;
    }
    return [...this.stocks.values()].filter((s) => s.bars.length);
  }
}

/** Compact bars for the wire: [date, open, high, low, close, volume]. */
export const packBars = (bars) => bars.map((b) => [b.d, round(b.o), round(b.h), round(b.l), round(b.c), b.v || 0]);
