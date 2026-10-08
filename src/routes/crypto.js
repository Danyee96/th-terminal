import { Router } from "express";
import { DEFAULT_CFG, SIGNALS } from "../shared/indicators.js";
import { packBars } from "../services/market.js";

const r = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function summary(c, deriv) {
  const d = deriv?.find((x) => x.tk === c.tk) || {};
  return {
    symbol: c.tk, name: c.name, category: c.sector, themes: c.themes, rank: c.rank, image: c.image,
    price: r(c.price, 8), date: c.bars.at(-1).d,
    change: { d1: r(c.chg), w1: r(c.chgW), m1: r(c.chgM), m3: r(c.chg3M) },
    marketCapB: r(c.capNow), volume24hB: r(c.volB), circulatingSupply: c.circ, ath: c.ath, fromAthPct: r(c.athChg),
    hci: { value: r(c.h), label: c.h <= DEFAULT_CFG.lo ? "too low" : c.h >= DEFAULT_CFG.hi ? "too high" : "neutral" },
    hillZone: { status: c.zone.status, sellers: c.zone.sellers.map((z) => ({ level: r(z.level, 8), touches: z.touches })), buyers: c.zone.buyers.map((z) => ({ level: r(z.level, 8), touches: z.touches })) },
    divergence: c.div ? c.div.type : null,
    goldenZone: { direction: c.golden.dir, top: r(c.golden.top, 8), bottom: r(c.golden.bot, 8), inZone: c.golden.inZone },
    confluence: c.setup,
    derivatives: { fundingRate: d.funding ?? null, openInterestUsd: d.oiUsd ?? null, oiChange24hPct: r(d.oiChg24h), oiChange7dPct: r(d.oiChg7d), longShort: d.ls ?? null, liquidations24h: d.liq },
  };
}

export function cryptoRouter(crypto) {
  const api = Router();
  api.use((_req, res, next) => (crypto ? next() : res.status(404).json({ error: "The crypto module is turned off (CRYPTO_ENABLED=false)." })));
  const ready = async (req, _res, next) => { await crypto.ready; req.recheckAccess ? req.recheckAccess(next) : next(); };

  api.get("/status", (_req, res) => res.json(crypto.status));
  api.get("/bootstrap", ready, (_req, res) => res.json(crypto.bootstrap()));

  api.get("/coins", ready, (_req, res) => {
    const deriv = crypto.derivPayload();
    res.json(crypto.computed().map((c) => summary(c, deriv)));
  });

  api.get("/coins/:symbol", ready, (req, res) => {
    const tk = req.params.symbol.toUpperCase();
    const c = crypto.computed().find((x) => x.tk === tk);
    if (!c) return res.status(404).json({ error: `Unknown coin ${tk}` });
    res.json({ ...summary(c, crypto.derivPayload()), bars: packBars(c.bars), hciSeries: c.hci.map((v) => r(v)) });
  });

  /** Same filters as the stock screener: signals, group (category/theme), hciMin, hciMax, sort, dir, limit. */
  api.get("/screener", ready, (req, res) => {
    const q = req.query;
    const ids = String(q.signals || "").split(",").filter(Boolean);
    const bad = ids.filter((id) => !SIGNALS.some((s) => s.id === id));
    if (bad.length) return res.status(400).json({ error: `Unknown signal(s): ${bad.join(", ")}` });
    const min = q.hciMin != null ? +q.hciMin : -5, max = q.hciMax != null ? +q.hciMax : 5;
    const key = { hci: (c) => c.h, change: (c) => c.chg, marketCap: (c) => c.capNow }[q.sort] || ((c) => c.capNow);
    const rows = crypto.computed()
      .filter((c) => ids.every((id) => SIGNALS.find((s) => s.id === id).test(c, DEFAULT_CFG)) && (!q.group || c.sector === q.group || c.themes.includes(q.group)) && c.h >= min && c.h <= max)
      .sort((a, b) => (key(a) - key(b)) * (q.dir === "asc" ? 1 : -1))
      .slice(0, Math.min(+q.limit || 500, 500));
    const deriv = crypto.derivPayload();
    res.json({ count: rows.length, results: rows.map((c) => summary(c, deriv)) });
  });

  api.get("/derivatives", ready, (_req, res) => res.json({ source: crypto.status.derivatives, coins: crypto.derivPayload() }));

  /** Whale feed. Query: kind=trade|liquidation|onchain, symbol=BTC, minUsd=1000000, limit=100 */
  api.get("/whales", ready, (req, res) => {
    const { kind, symbol, minUsd, limit } = req.query;
    const rows = crypto.whales.filter((w) => (!kind || w.kind === kind) && (!symbol || w.sym === symbol.toUpperCase()) && (!minUsd || w.usd >= +minUsd));
    res.json({ thresholds: crypto.status.whaleMinUsd, count: rows.length, results: rows.slice(0, Math.min(+limit || 100, 400)) });
  });

  api.get("/research", ready, (_req, res) => res.json(crypto.research));

  return api;
}
