/**
 * Finnhub real-time trade stream (optional).
 * Free key: https://finnhub.io/register  → set FINNHUB_API_KEY in .env
 * The free plan streams US trades for up to 50 symbols over one websocket.
 */
import WebSocket from "ws";

export function createFinnhubStream({ key, symbols, onTrade, onState, log }) {
  let ws = null, alive = true, retry = 0;

  const connect = () => {
    ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`);
    ws.on("open", () => {
      retry = 0;
      onState?.(true);
      log.info(`Finnhub stream connected, subscribing to ${symbols.length} symbols`);
      for (const s of symbols) ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
    });
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.type === "trade") for (const t of m.data || []) onTrade({ sym: t.s, price: t.p, ts: t.t });
      else if (m.type === "error") log.warn(`Finnhub: ${m.msg}`);
    });
    ws.on("close", () => {
      onState?.(false);
      if (!alive) return;
      const wait = Math.min(60000, 1000 * 2 ** retry++);
      log.warn(`Finnhub stream closed, reconnecting in ${Math.round(wait / 1000)}s`);
      setTimeout(connect, wait);
    });
    ws.on("error", (e) => log.warn(`Finnhub socket error: ${e.message}`));
  };

  connect();
  return { close() { alive = false; ws?.close(); } };
}
