/**
 * Simulated provider — offline development and demos.
 * Run with DATA_PROVIDER=simulated. Prices are random and NOT real.
 */
import { UNIVERSE } from "../universe.js";

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function weekdays(n) {
  const out = [], x = new Date();
  x.setUTCHours(0, 0, 0, 0);
  while (out.length < n) { const w = x.getUTCDay(); if (w && w < 6) out.unshift(x.toISOString().slice(0, 10)); x.setUTCDate(x.getUTCDate() - 1); }
  return out;
}

/** Deterministic fake daily history for one ticker. */
export function simulatedHistory(tk, n = 504) {
  const target = UNIVERSE.find((u) => u.tk === tk)?.price || 100;
  const r = rng(hash(tk + "th-terminal"));
  const vol = 0.011 + r() * 0.019, drift = (r() - 0.38) * 0.001;
  const P1 = 38 + r() * 55, P2 = 11 + r() * 15, A1 = 0.05 + r() * 0.1, A2 = 0.02 + r() * 0.045, f1 = r() * 6.28, f2 = r() * 6.28;
  const lp = []; let w = 0;
  for (let i = 0; i < n; i++) { w += drift + gauss(r) * vol * 0.55; lp.push(w + A1 * Math.sin((2 * Math.PI * i) / P1 + f1) + A2 * Math.sin((2 * Math.PI * i) / P2 + f2)); }
  const k = Math.log(target) - lp[n - 1], days = weekdays(n), bars = [];
  let prev = Math.exp(lp[0] + k);
  for (let i = 0; i < n; i++) {
    const c = Math.exp(lp[i] + k), o = prev * (1 + gauss(r) * vol * 0.25);
    bars.push({ d: days[i], o, h: Math.max(o, c) * (1 + Math.abs(gauss(r)) * vol * 0.45), l: Math.min(o, c) * (1 - Math.abs(gauss(r)) * vol * 0.45), c, v: Math.round(1e6 + r() * 5e7) });
    prev = c;
  }
  return bars;
}

export function createSimulatedProvider() {
  const last = new Map();
  return {
    id: "simulated",
    label: "Simulated data",
    mode: "simulated",
    alwaysOpen: true, // treat the market as open so prices keep moving
    async history(sym) {
      const bars = simulatedHistory(sym);
      last.set(sym, { price: bars.at(-1).c, open: bars.at(-1).o });
      return bars;
    },
    async quotes(syms) {
      return syms.filter(() => Math.random() < 0.35).map((sym) => {
        const s = last.get(sym) || { price: 100, open: 100 };
        s.price *= 1 + (s.open / s.price - 1) * 0.03 + gauss(Math.random) * 0.004;
        last.set(sym, s);
        return { sym, price: s.price, open: s.open, ts: Date.now(), marketStatus: "Simulated" };
      });
    },
    async marketCap() { return null; },
  };
}
