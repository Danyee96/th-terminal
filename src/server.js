import http from "node:http";
import path from "node:path";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { createProvider } from "./providers/index.js";
import { Market } from "./services/market.js";
import { apiRouter } from "./routes/api.js";
import { cryptoRouter } from "./routes/crypto.js";
import { CryptoMarket } from "./services/crypto.js";

import { createAuth } from "./auth.js";
const auth = createAuth({ root: config.root });
const saved = auth.settings;
if (saved.provider) config.provider = saved.provider;
if (saved.quotePollMs) config.quotePollMs = saved.quotePollMs;
if (saved.finnhubKey !== undefined) config.finnhubKey = saved.finnhubKey;
if (saved.coingeckoKey !== undefined) process.env.COINGECKO_API_KEY = saved.coingeckoKey;
const log = createLogger(config.logLevel);
const provider = createProvider(config, log);
const market = new Market({ provider, config, log });
const crypto = config.crypto ? new CryptoMarket({ config, log }) : null;

/* ------------------------------- HTTP ------------------------------- */
const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
// cache static files in production only, so edits show up immediately while developing
const maxAge = process.env.NODE_ENV === "production" ? "5m" : 0;
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "16kb" }));
app.use("/api", auth.router);
app.get("/api/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use("/api/crypto", auth.market("crypto"), cryptoRouter(crypto));
app.use("/api", auth.market("stocks"), apiRouter(market));
app.get("/", (_req, res) => res.redirect("/login.html"));
app.get("/terminal", (req, res) => auth.active(auth.userFor(req)) ? res.sendFile(path.join(config.root, "public/index.html")) : res.redirect("/login.html"));
app.get("/index.html", (_req, res) => res.redirect("/login.html"));
app.get("/admin.html", (req, res, next) => auth.userFor(req)?.role === "superadmin" && auth.active(auth.userFor(req)) ? next() : res.redirect("/login.html"));
app.use("/shared", express.static(path.join(config.root, "src/shared"), { maxAge }));
app.use(express.static(path.join(config.root, "public"), { maxAge }));
app.use((err, _req, res, _next) => {
  log.error(err.stack || err.message);
  res.status(err.status === 400 ? 400 : err.status === 413 ? 413 : 500).json({ error: err.status === 400 ? "Invalid JSON request." : err.status === 413 ? "Request too large." : "Something went wrong on the server." });
});

const server = http.createServer(app);

/* ----------------------------- WebSocket ---------------------------- */
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws" || (req.headers.origin && req.headers.origin !== `${req.socket.encrypted || (process.env.TRUST_PROXY === "1" && req.headers["x-forwarded-proto"] === "https") ? "https" : "http"}://${req.headers.host}`) || !auth.active(auth.userFor(req))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => { ws.authRequest = req; wss.emit("connection", ws); });
});
const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(msg);
const broadcast = (type, data, mk = "stocks") => {
  const msg = JSON.stringify({ type, market: mk, data });
  for (const ws of wss.clients) {
    const user = auth.userFor(ws.authRequest);
    if (!auth.active(user)) { ws.close(4001, "Access ended"); continue; }
    if (auth.allowed(user, mk)) send(ws, msg);
  }
};

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  if (auth.allowed(auth.userFor(ws.authRequest), "stocks")) send(ws, JSON.stringify({ type: "status", market: "stocks", data: market.status }));
  if (crypto && auth.allowed(auth.userFor(ws.authRequest), "crypto")) send(ws, JSON.stringify({ type: "status", market: "crypto", data: crypto.status }));
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

market.on("quotes", (batch) => broadcast("quotes", batch));
market.on("history", (h) => broadcast("history", h));
market.on("meta", (m) => broadcast("meta", m));
setInterval(() => broadcast("status", market.status), 5000);

if (crypto) {
  for (const type of ["quotes", "history", "meta", "deriv", "whales", "research"]) crypto.on(type, (d) => broadcast(type, d, "crypto"));
  setInterval(() => broadcast("status", crypto.status, "crypto"), 5000);
}

/* ------------------------------- Boot ------------------------------- */
server.listen(config.port, () => {
  log.info(`TH Terminal running at http://localhost:${config.port}`);
  log.info(`Data provider: ${provider.label}${config.finnhubKey ? " + Finnhub real-time stream" : ""}`);
});
market.start().catch((e) => log.error(`Market failed to start: ${e.stack || e.message}`));
crypto?.start().catch((e) => log.error(`Crypto failed to start: ${e.stack || e.message}`));

const shutdown = () => {
  log.info("Shutting down…");
  market.stop();
  crypto?.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
