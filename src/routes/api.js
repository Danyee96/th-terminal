import { Router } from "express";
import { DEFAULT_CFG, SIGNALS } from "../shared/indicators.js";
import { packBars } from "../services/market.js";

const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
const hciLabel = (h, c = DEFAULT_CFG) => (h <= c.lo ? "too low" : h >= c.hi ? "too high" : "neutral");

/** Public JSON shape of one stock's toolkit readings. */
function summary(s) {
  return {
    ticker: s.tk, name: s.name, sector: s.sector, themes: s.themes, source: s.source,
    price: r4(s.price), date: s.bars.at(-1).d,
    change: { d1: r4(s.chg), w1: r4(s.chgW), m1: r4(s.chgM), m3: r4(s.chg3M) },
    marketCapB: s.capNow>0?r4(s.capNow):null,
    dataQuality: { historyStale: !!s.historyStale, historyUpdatedAt: s.histAt || null, quoteTimestamp: s.quote?.ts || null, indicatorFormulas: "prototype" },
    hci: { value: r4(s.h), label: hciLabel(s.h) },
    hillZone: {
      status: s.zone.status,
      sellers: s.zone.sellers.map((z) => ({ level: r4(z.level), touches: z.touches })),
      buyers: s.zone.buyers.map((z) => ({ level: r4(z.level), touches: z.touches })),
    },
    divergence: s.div ? s.div.type : null,
    goldenZone: { direction: s.golden.dir, top: r4(s.golden.top), bottom: r4(s.golden.bot), inZone: s.golden.inZone },
    confluence: s.setup,
    above50dma: s.above50,
    quote: s.quote,
  };
}

export function apiRouter(market) {
  const api = Router();
  const ready = async (req, _res, next) => { await market.ready; req.recheckAccess ? req.recheckAccess(next) : next(); };

  api.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  api.get("/status", (_req, res) => res.json(market.status));

  /** Everything the browser needs to start: stock list + daily bars. */
  api.get("/bootstrap", ready, (_req, res) => res.json(market.bootstrap()));

  /** All stocks with their current toolkit readings. */
  api.get("/stocks", ready, (_req, res) => res.json(market.computed().map(summary)));

  /** One stock with full daily bars and the HCI series. */
  api.get("/stocks/:ticker", ready, (req, res) => {
    const tk = req.params.ticker.toUpperCase();
    const s = market.computed().find((x) => x.tk === tk);
    if (!s) return res.status(404).json({ error: `Unknown ticker ${tk}` });
    res.json({ ...summary(s), bars: packBars(s.bars), hciSeries: s.hci.map(r4) });
  });

  /**
   * Screener. Query params (all optional):
   *   signals=os,bz     comma list of signal ids (see /api/signals), all must match
   *   group=AI          sector or theme
   *   hciMin=-5&hciMax=0
   *   sort=hci|change|marketCap   dir=asc|desc   limit=50
   */
  api.get("/screener", ready, (req, res) => {
    const q = req.query;
    const ids = String(q.signals || "").split(",").filter(Boolean);
    const unknown = ids.filter((id) => !SIGNALS.some((s) => s.id === id));
    if (unknown.length) return res.status(400).json({ error: `Unknown signal(s): ${unknown.join(", ")}` });
    const min = q.hciMin != null ? +q.hciMin : -5, max = q.hciMax != null ? +q.hciMax : 5;
    let rows = market.computed().filter((s) =>
      ids.every((id) => SIGNALS.find((x) => x.id === id).test(s, DEFAULT_CFG)) &&
      (!q.group || s.sector === q.group || s.themes.includes(q.group)) &&
      s.h >= min && s.h <= max);
    const key = { hci: (s) => s.h, change: (s) => s.chg, marketCap: (s) => s.capNow }[q.sort] || ((s) => s.capNow);
    const dir = q.dir === "asc" ? 1 : -1;
    rows = rows.sort((a, b) => (key(a) - key(b)) * dir).slice(0, Math.min(+q.limit || 500, 500));
    res.json({ count: rows.length, results: rows.map(summary) });
  });

  api.get("/signals", (_req, res) => res.json(SIGNALS.map((s) => ({ id: s.id, label: s.label(DEFAULT_CFG) }))));

  return api;
}
