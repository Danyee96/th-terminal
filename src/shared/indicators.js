/**
 * TH indicator engine — shared by the Node server and the browser.
 * The browser loads this exact file from /shared/indicators.js, so keep it
 * dependency-free and environment-neutral (no Node or DOM APIs).
 *
 * NOTE: these are prototype formulas. Replace the bodies of computeHCI,
 * computeHillZones, computeDivergence and computeGoldenZone with the
 * TH Toolkit's real logic so the terminal matches the TradingView indicators.
 *
 * A "series" object is anything with `bars: [{ d, o, h, l, c, v }]`, oldest first.
 */

export const DEFAULT_CFG = Object.freeze({
  hi: 3,     // HCI at or above → "too high"
  lo: -3,    // HCI at or below → "too low"
  prox: 1.5, // % distance from a Hill Zone that counts as "in the zone"
  tol: 1.5,  // % tolerance when clustering swing points into one zone
});

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function ema(a, n) {
  const k = 2 / (n + 1);
  let p = NaN;
  return a.map((v) => {
    if (Number.isNaN(v)) return NaN;
    p = Number.isNaN(p) ? v : v * k + p * (1 - k);
    return p;
  });
}

export function sma(a, n) {
  const out = [];
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    out.push(i >= n - 1 ? s / n : NaN);
  }
  return out;
}

export function rsi(c, n = 14) {
  const out = Array(c.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i === n) { g /= n; l /= n; out[i] = g===0&&l===0?50:l===0?100:100-100/(1+g/l); }
    } else {
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
      out[i] = g===0&&l===0?50:l===0?100:100-100/(1+g/l);
    }
  }
  return out;
}

/** Confirmed swing highs/lows: a bar higher/lower than L bars before and R bars after. */
export function pivots(b, L = 5, R = 5) {
  const hi = [], lo = [];
  for (let i = L; i < b.length - R; i++) {
    let isH = true, isL = true;
    for (let j = i - L; j <= i + R; j++) {
      if (j === i) continue;
      if (b[j].h >= b[i].h) isH = false;
      if (b[j].l <= b[i].l) isL = false;
    }
    if (isH) hi.push({ i, p: b[i].h });
    if (isL) lo.push({ i, p: b[i].l });
  }
  return { hi, lo };
}

/** Merge price points within `tol` (fraction) of each other into zones. */
export function cluster(pts, tol) {
  const sorted = [...pts].sort((a, b) => a.p - b.p), out = [];
  for (const x of sorted) {
    const c = out[out.length - 1];
    if (c && Math.abs(x.p - c.level) / c.level <= tol) {
      c.sum += x.p; c.n++; c.level = c.sum / c.n; c.last = Math.max(c.last, x.i);
    } else out.push({ level: x.p, sum: x.p, n: 1, last: x.i });
  }
  return out.map((c) => ({ level: c.level, touches: c.n, last: c.last }));
}

/* ------------------------------------------------------------------ */
/* Toolkit indicators                                                  */
/* ------------------------------------------------------------------ */

/** Hill Conviction Index, −5 (too low) … +5 (too high). */
export function computeHCI(bars) {
  const c = bars.map((x) => x.c);
  const R = rsi(c);
  const st = c.map((v, i) => {
    if (i < 20) return NaN;
    let lo = Infinity, hi = -Infinity;
    for (let j = i - 20; j <= i; j++) { if (bars[j].l < lo) lo = bars[j].l; if (bars[j].h > hi) hi = bars[j].h; }
    return hi===lo?50:((v - lo)/(hi - lo))*100;
  });
  const z = c.map((v, i) => {
    if (i < 49) return NaN;
    let m = 0;
    for (let j = i - 49; j <= i; j++) m += c[j];
    m /= 50;
    let sd = 0;
    for (let j = i - 49; j <= i; j++) sd += (c[j] - m) ** 2;
    sd = Math.sqrt(sd / 50) || 1;
    return clamp(50 + (20 * (v - m)) / sd, 0, 100);
  });
  const raw = c.map((_, i) =>
    Number.isNaN(R[i]) || Number.isNaN(st[i]) || Number.isNaN(z[i]) ? NaN : 0.45 * R[i] + 0.3 * st[i] + 0.25 * z[i]);
  return ema(raw, 3).map((v) => (Number.isNaN(v) ? NaN : clamp((v - 50) / 8, -5, 5)));
}

/** Buyer (green) and seller (red) zones from clustered swing points. */
export function computeHillZones(bars, pv, cfg) {
  const n = bars.length, close = bars[n - 1].c, from = Math.max(0, n - 200);
  const tol = cfg.tol / 100, prox = cfg.prox / 100;
  const sellers = cluster(pv.hi.filter((p) => p.i >= from), tol)
    .filter((z) => z.level >= close * (1 - prox)).sort((a, b) => a.level - b.level).slice(0, 3);
  const buyers = cluster(pv.lo.filter((p) => p.i >= from), tol)
    .filter((z) => z.level <= close * (1 + prox)).sort((a, b) => b.level - a.level).slice(0, 3);
  const dS = sellers[0] ? Math.abs(sellers[0].level - close) / close : 1;
  const dB = buyers[0] ? Math.abs(buyers[0].level - close) / close : 1;
  let status = "neutral";
  if (Math.min(dS, dB) <= prox) status = dS < dB ? "seller" : "buyer";
  return { status, sellers, buyers, near: status === "seller" ? sellers[0] : status === "buyer" ? buyers[0] : null };
}

/** Bullish / bearish divergence between the last two swing points and the HCI. */
export function computeDivergence(bars, pv, hci) {
  const n = bars.length;
  const lows = pv.lo.filter((p) => p.i >= n - 90), highs = pv.hi.filter((p) => p.i >= n - 90);
  const check = (arr, type) => {
    if (arr.length < 2) return null;
    const a = arr[arr.length - 2], b = arr[arr.length - 1];
    if (b.i - a.i < 5 || n - 1 - b.i > 25 || Number.isNaN(hci[a.i]) || Number.isNaN(hci[b.i])) return null;
    if (type === "bull" && b.p < a.p && hci[b.i] > hci[a.i] + 0.25 && hci[a.i] < -0.6)
      return { type, a: { ...a, h: hci[a.i] }, b: { ...b, h: hci[b.i] } };
    if (type === "bear" && b.p > a.p && hci[b.i] < hci[a.i] - 0.25 && hci[a.i] > 0.6)
      return { type, a: { ...a, h: hci[a.i] }, b: { ...b, h: hci[b.i] } };
    return null;
  };
  const bull = check(lows, "bull"), bear = check(highs, "bear");
  return bull && bear ? (bull.b.i > bear.b.i ? bull : bear) : bull || bear;
}

/** 0.5–0.618 retracement of the dominant swing in the last 120 bars. */
export function computeGoldenZone(bars) {
  const n = bars.length, W = Math.min(120, n - 1), close = bars[n - 1].c;
  let hiI = n - W, loI = n - W;
  for (let i = n - W; i < n; i++) { if (bars[i].h > bars[hiI].h) hiI = i; if (bars[i].l < bars[loI].l) loI = i; }
  const H = bars[hiI].h, L = bars[loI].l, rg = H - L, up = loI < hiI;
  const lv = (f) => (up ? H - rg * f : L + rg * f);
  const top = Math.max(lv(0.5), lv(0.618)), bot = Math.min(lv(0.5), lv(0.618));
  return {
    dir: up ? "bull" : "bear", top, bot, from: Math.min(hiI, loI), hiI, loI,
    inZone: rg>0 && close >= bot * 0.997 && close <= top * 1.003,
    fibs: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((f) => ({ f, p: lv(f) })),
  };
}

/** Run every indicator on a series and attach the results to it. */
export function computeCore(o, cfg = DEFAULT_CFG) {
  const b = o.bars, c = b.map((x) => x.c);
  o.hci = computeHCI(b);
  o.sma20 = sma(c, 20);
  o.sma50 = sma(c, 50);
  const pv = pivots(b);
  o.zone = computeHillZones(b, pv, cfg);
  o.div = computeDivergence(b, pv, o.hci);
  o.golden = computeGoldenZone(b);
  return o;
}

/** 0–5 confluence score on each side. */
export function setupOf(s, cfg = DEFAULT_CFG) {
  const h = s.h;
  const bull = (h <= cfg.lo ? 2 : h < 0 ? 1 : 0) + (s.zone.status === "buyer") + (s.div?.type === "bull") + (s.golden.inZone && s.golden.dir === "bull");
  const bear = (h >= cfg.hi ? 2 : h > 0 ? 1 : 0) + (s.zone.status === "seller") + (s.div?.type === "bear") + (s.golden.inZone && s.golden.dir === "bear");
  return { bull, bear, side: bull > bear ? "bull" : bear > bull ? "bear" : "flat", score: Math.max(bull, bear) };
}

/** Full per-stock calculation: indicators + returns + market cap + setup score. */
export function computeStock(s, cfg = DEFAULT_CFG) {
  computeCore(s, cfg);
  const b = s.bars, n = b.length, last = b[n - 1].c;
  const ch = (k) => (n > k ? (last / b[n - 1 - k].c - 1) * 100 : 0);
  s.price = last;
  const crypto=s.mk === "crypto" || !!s.pair;
  s.chg = !crypto&&s.quote?.session==="open"&&s.quote?.prevClose>0?(last/s.quote.prevClose-1)*100:ch(1); s.chgW = ch(crypto?7:5); s.chgM = ch(crypto?30:21); s.chg3M = ch(crypto?90:63);
  s.h = s.hci[n - 1];
  s.capNow = s.shares ? (s.shares * last) / 1e9 : s.capB || 0; // $ billions
  s.above50 = last > s.sma50[n - 1];
  s.spark = b.slice(-30).map((x) => x.c);
  s.setup = setupOf(s, cfg);
  s.w = null; // weekly series is rebuilt lazily
  return s;
}

/** Aggregate daily bars into weekly bars (Mon–Fri), dated by the week's last session. */
export function toWeekly(bars) {
  const out = [];
  let key = null, cur = null;
  for (const x of bars) {
    const dt = new Date(x.d + "T00:00:00Z");
    const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    if (monday !== key) {
      if (cur) out.push(cur);
      key = monday;
      cur = { d: x.d, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 };
    } else {
      cur.d = x.d; cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Screener signals — used by the server API and the browser filters. */
export const SIGNALS = [
  { id: "os", label: (c) => `HCI too low ≤ ${c.lo}`, test: (s, c) => s.h <= c.lo },
  { id: "ob", label: (c) => `HCI too high ≥ +${c.hi}`, test: (s, c) => s.h >= c.hi },
  { id: "bz", label: () => "Buyer zone", test: (s) => s.zone.status === "buyer" },
  { id: "sz", label: () => "Seller zone", test: (s) => s.zone.status === "seller" },
  { id: "bd", label: () => "Bullish divergence", test: (s) => s.div?.type === "bull" },
  { id: "brd", label: () => "Bearish divergence", test: (s) => s.div?.type === "bear" },
  { id: "gz", label: () => "Golden zone", test: (s) => s.golden.inZone },
  { id: "cb", label: () => "Bull confluence ≥ 3", test: (s) => s.setup.bull >= 3 },
  { id: "cs", label: () => "Bear confluence ≥ 3", test: (s) => s.setup.bear >= 3 },
  { id: "up50", label: () => "Above 50-day", test: (s) => s.above50 },
];
