/**
 * Bybit public data — free, no API key.
 * Used for the futures trade stream (whale trades) and liquidations,
 * and as a fallback for funding / open interest.
 */
import WebSocket from "ws";
import { getJSON, chunk } from "../../lib/http.js";

const REST = "https://api.bybit.com";

/** Map coin symbol → Bybit USDT perpetual (handles 1000PEPE / SHIB1000 style contracts). */
export async function linearSymbols(coins) {
  const j = await getJSON(`${REST}/v5/market/instruments-info?category=linear&limit=1000`);
  const list = (j?.result?.list || []).filter((x) => x.quoteCoin === "USDT" && x.status === "Trading" && x.contractType === "LinearPerpetual");
  const by = new Map(list.map((x) => [x.symbol, x]));
  const out = {};
  for (const tk of coins) {
    const s = [`${tk}USDT`, `1000${tk}USDT`, `${tk}1000USDT`, `10000${tk}USDT`].find((c) => by.has(c));
    if (s) out[tk] = s;
  }
  return out;
}

/** Funding + open interest for every linear perpetual (fallback when Binance futures is unavailable). */
export async function linearTickers() {
  const j = await getJSON(`${REST}/v5/market/tickers?category=linear`);
  return (j?.result?.list || []).map((r) => ({ symbol: r.symbol, funding: +r.fundingRate, oiUsd: +r.openInterestValue, nextFunding: +r.nextFundingTime }));
}

/**
 * Stream futures trades and liquidations.
 * onTrade({ sym, side: "buy"|"sell", usd, price, ts })
 * onLiquidation({ sym, side: "long"|"short", usd, price, ts })  side = the position that was liquidated
 */
export function createBybitStream({ symbols, tradeSymbols, onTrade, onLiquidation, onState, log }) {
  let ws = null, alive = true, retry = 0, ping = null;
  const back = Object.fromEntries(Object.entries(symbols).map(([tk, s]) => [s, tk]));
  const topics = [
    ...Object.values(symbols).map((s) => `allLiquidation.${s}`),
    ...tradeSymbols.filter((tk) => symbols[tk]).map((tk) => `publicTrade.${symbols[tk]}`),
  ];

  const connect = () => {
    ws = new WebSocket(`wss://stream.bybit.com/v5/public/linear`);
    ws.on("open", () => {
      retry = 0;
      onState?.(true);
      for (const args of chunk(topics, 10)) ws.send(JSON.stringify({ op: "subscribe", args }));
      ping = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ op: "ping" })), 20000);
      log.info(`Bybit stream connected (${topics.length} topics)`);
    });
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m.topic) return;
      if (m.topic.startsWith("publicTrade.")) {
        for (const t of m.data || []) {
          const tk = back[t.s]; if (!tk) continue;
          onTrade({ sym: tk, side: t.S === "Buy" ? "buy" : "sell", usd: +t.v * +t.p, price: +t.p, ts: +t.T, venue: "Bybit perps" });
        }
      } else if (m.topic.startsWith("allLiquidation.")) {
        for (const l of m.data || []) {
          const tk = back[l.s]; if (!tk) continue;
          // Bybit: "Buy" update = a long position was liquidated
          onLiquidation({ sym: tk, side: l.S === "Buy" ? "long" : "short", usd: +l.v * +l.p, price: +l.p, ts: +l.T, venue: "Bybit" });
        }
      }
    });
    ws.on("close", () => {
      clearInterval(ping);
      onState?.(false);
      if (!alive) return;
      const wait = Math.min(60000, 1000 * 2 ** retry++);
      setTimeout(connect, wait);
    });
    ws.on("error", (e) => log.warn(`Bybit stream error: ${e.message}`));
  };
  connect();
  return { close() { alive = false; ws?.close(); } };
}
