# TH Terminal

A market terminal for the **TH Toolkit**, with two modules:

- **Stocks:** heat map, screener, charts, watchlists and alerts for 68 large-cap US stocks.
- **Crypto:** the same toolkit views for 46 coins, plus derivatives (funding, open interest, long/short, liquidations), a whale tracker, and DeFi & DEX research.

Every view is driven by the toolkit's indicators: HCI, HCI Heatmap, Hill Zones, Divergence and Golden Zone. When the app opens, customers pick **Stocks** or **Crypto**; they can switch any time from the top bar (or press **M**).

- **Backend:** Node.js + Express. It loads price history, polls live quotes, and pushes updates to browsers over WebSocket.
- **Frontend:** plain HTML, CSS and JavaScript in `public/`, with no build step.
- **Indicators:** `src/shared/indicators.js`. The server and the browser run the same file.

> Prices come from free public sources and can be delayed. Nothing here is investment advice.

---

## Quick start

You need **Node.js 18.17 or newer** (20 recommended): https://nodejs.org

```bash
npm install
cp .env.example .env      # skip if .env already exists
npm run dev               # restarts automatically when you save a file
```

Open **http://localhost:3000**. The first start downloads about 2 years of daily history for every stock, which takes around 5–30 seconds. After that it loads from `data/cache/`.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with auto-restart, using live Nasdaq data |
| `npm run dev:sim` | Same, but with simulated prices (works offline) |
| `npm start` | Production start |
| `npm run clear-cache` | Delete cached history so it downloads fresh on the next start |

### In Visual Studio Code
1. **File → Open Folder…** and choose `th-terminal`.
2. Install the recommended extensions when VS Code asks.
3. Press **F5** and pick **TH Terminal (live data)**. Breakpoints work in all server files.
4. Open `api.http` and click **Send Request** above any line to try the API.

---

## Where the data comes from

| Source | Key needed? | Provides | Notes |
|---|---|---|---|
| **Nasdaq public API** (default) | No | Daily history (2 yrs), live last-sale quotes polled every 15 s, market caps | The API behind nasdaq.com. Free and unofficial, so it can change or rate-limit without notice. |
| **Finnhub** (optional) | Free key | Real-time trade stream (WebSocket), up to 50 symbols on the free plan | Add `FINNHUB_API_KEY` to `.env`. The largest 50 stocks stream; the rest keep polling. |
| **Simulated** | No | Random prices for offline work | `DATA_PROVIDER=simulated` |

If history for one stock can't be downloaded, that stock falls back to simulated prices. It shows a **SIM** badge in the screener and is listed in `/api/status` under `fallbacks`.

**Before charging users:** redistributing exchange data to paying customers needs a licensed feed. Good options are Polygon.io, Alpaca, Finnhub's paid plans, and Twelve Data. Each can be added as a provider (see below) without touching the UI.

### Crypto data sources (all free, no keys)

| Layer | Source | What it powers |
|---|---|---|
| Prices | **Binance** spot: 2 yrs of daily candles + live WebSocket stream | Charts, HCI, zones, live prices (24/7) |
| Market data | **CoinGecko** | Market cap, rank, supply, ATH, global market cap, BTC dominance, trending coins |
| Derivatives | **Binance futures** (Bybit fallback) | Funding rates, open interest + 24h/7d change, long/short account ratio |
| Liquidations | **Bybit** WebSocket | Liquidation totals per coin, large liquidations in the whale feed |
| Whales | **Binance spot + Bybit perps** trade streams, **blockchain.info** | Large single trades, large on-chain BTC transactions |
| Sentiment | **alternative.me** | Crypto Fear & Greed index (30 days) |
| DeFi | **DeFiLlama** | Total TVL, TVL by chain, stablecoin supply, DEX volume |
| DEX | **GeckoTerminal** | Trending DEX pools across networks |

Whale thresholds are set in `.env` (`WHALE_TRADE_USD`, `WHALE_TRADE_USD_ALTS`, `WHALE_BTC_ONCHAIN`, `LIQUIDATION_WHALE_USD`).
To track more chains or label wallets (exchange names, funds), add a paid on-chain API such as Whale Alert, Arkham or Nansen as a new provider in `src/providers/crypto/`.

**Hosting note:** Binance blocks requests from US-based servers. When you deploy, choose an EU or Asia region (Render: Frankfurt or Singapore). Binance's futures *WebSocket* is also blocked in some regions, which is why liquidations and futures trades come from Bybit.

### Market hours
Today's candle only updates during the regular session (9:30–16:00 ET). Before and after hours, the terminal shows the last close, and the top bar says which session it is.

---

## Adding a new data API

1. Copy `src/providers/_template.js` to `src/providers/<name>.js` and fill in `history()`, `quotes()` and (optionally) `marketCap()`.
2. Register it in `src/providers/index.js`:
   ```js
   import { createPolygonProvider } from "./polygon.js";
   const PROVIDERS = {
     nasdaq: () => createNasdaqProvider(),
     polygon: (cfg) => createPolygonProvider({ apiKey: process.env.POLYGON_API_KEY }),
     simulated: () => createSimulatedProvider(),
   };
   ```
3. Add the key to `.env` and set `DATA_PROVIDER=polygon`.

Every provider returns the same shapes, so caching, live candles, indicators and the UI work unchanged.

## Plugging in the real TH Toolkit formulas

The indicator maths in `src/shared/indicators.js` is a **prototype approximation**. To match the TradingView toolkit, replace the bodies of:

- `computeHCI()`: Hill Conviction Index, −5 … +5
- `computeHillZones()`: buyer and seller zones
- `computeDivergence()`
- `computeGoldenZone()`

Keep the return shapes the same and the rest of the app follows. The thresholds (too high / too low, zone distance) can also be changed per user in **Settings** inside the app.

---

## REST API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/status` | Data source, market session, last quote time, load progress, fallbacks |
| `GET /api/stocks` | Every stock with its toolkit readings |
| `GET /api/stocks/:ticker` | One stock, plus daily bars and the HCI series |
| `GET /api/screener` | Filtered list. Query: `signals=os,bz` · `group=AI` · `hciMin` · `hciMax` · `sort=hci\|change\|marketCap` · `dir=asc\|desc` · `limit` |
| `GET /api/signals` | Signal ids for the screener |
| `GET /api/bootstrap` | Everything the browser needs at start-up |
| `WS /ws` | Live messages `{ type, market, data }`: `quotes`, `history`, `meta`, `status`, and for crypto also `deriv`, `whales`, `research` |
| `GET /api/crypto/coins` | Every coin with toolkit readings + derivatives |
| `GET /api/crypto/coins/:symbol` | One coin with daily bars and the HCI series |
| `GET /api/crypto/screener` | Same filters as the stock screener |
| `GET /api/crypto/derivatives` | Funding, open interest, long/short, liquidations for every coin |
| `GET /api/crypto/whales` | Whale feed. Query: `kind=trade\|liquidation\|onchain` · `symbol` · `minUsd` · `limit` |
| `GET /api/crypto/research` | Global market, Fear & Greed, DeFi TVL, stablecoins, DEX volume, trending |

Server-side readings use the default thresholds (HCI ±3, 1.5 % zone distance).

---

## Project layout

```
th-terminal/
├─ src/
│  ├─ server.js            Express + WebSocket entry point
│  ├─ config.js            Reads settings from .env
│  ├─ universe.js          The list of tracked stocks (edit to add/remove)
│  ├─ crypto/universe.js   The list of tracked coins (edit to add/remove)
│  ├─ routes/api.js        Stock REST endpoints
│  ├─ routes/crypto.js     Crypto REST endpoints
│  ├─ services/market.js   Stocks: history cache, quote polling, live candles
│  ├─ services/crypto.js   Crypto: Binance stream, derivatives, whales, research feeds
│  ├─ providers/           Stock sources: nasdaq, finnhub, simulated, _template
│  │  └─ crypto/           Crypto sources: binance, bybit, coingecko, research
│  ├─ shared/indicators.js Toolkit indicators (server + browser)
│  └─ lib/                 HTTP helpers and logger
├─ public/                 The web app (index.html, css/, js/app.js, img/)
├─ data/cache/             Downloaded history (ignored by git)
├─ api.http                Clickable API examples for VS Code
├─ Dockerfile
└─ .env.example
```

Watchlists, alerts and settings are currently saved in each user's browser (localStorage). Moving them to a database with user accounts is the natural next step.

---

## Git and GitHub

```bash
git add .
git commit -m "Initial TH Terminal"
git branch -M main
git remote add origin https://github.com/<you>/th-terminal.git
git push -u origin main
```

`.env` and `data/cache/` are in `.gitignore`, so your API keys and downloaded data stay off GitHub.

## Going live

Any host that runs Node works. Two easy options:

**Render** (render.com) → New → Web Service → connect the GitHub repo
- Build command: `npm install`
- Start command: `npm start`
- Add environment variables from `.env.example` (`PORT` is set by Render)

**Railway** (railway.app) → New Project → Deploy from GitHub. It detects Node automatically; add your environment variables in the Variables tab.

**Docker** (VPS, Fly.io and similar):
```bash
docker build -t th-terminal .
docker run -p 3000:3000 --env-file .env th-terminal
```

The server keeps a WebSocket open to every browser, so choose a plan that doesn't sleep when idle if you want prices to stay live.

## Accounts and superadmin

The main link opens `/login.html`. Signing in opens `/terminal`. Superadmins have Users and API settings links at the bottom left, opening `/admin.html#users` and `/admin.html#api`, where they can create and edit users, choose full/stocks/crypto access, set unlimited access, a duration (7/30/90/365 days), or a custom expiry, disable accounts, and reset passwords. User changes invalidate that user's sessions. The last enabled superadmin cannot be disabled or demoted.

On the first startup, four testing accounts are created:

| Email | Role / access |
|---|---|
| admin@thterminal.test | Superadmin, all markets |
| full@thterminal.test | User, all markets |
| stocks@thterminal.test | User, stocks only |
| crypto@thterminal.test | User, crypto only |

Their initial password is `ThTerminal@123`, or the `TEST_ACCOUNT_PASSWORD` environment variable when provided before the first startup. Test accounts begin with unlimited access. Change their passwords in the admin panel before deploying publicly.

Passwords are stored as salted scrypt hashes; sessions use random tokens in HttpOnly, SameSite cookies and expire after 24 hours. Market permissions and account expiry are checked by the REST APIs and WebSocket broadcasts. Browser settings and watchlists are separated by account ID.

User accounts, sessions and API settings persist in `data/auth/store.json` (override the directory with `AUTH_DATA_DIR`). Keep this directory on persistent storage when hosting and restrict access to backups: saved provider keys are stored here. This file store is intended for one server instance; multiple replicas require shared transactional storage.

The admin panel supports Nasdaq/simulated stock provider selection, polling intervals, Finnhub keys and CoinGecko Demo keys. Saved settings override `.env` and apply on the next server restart. Adding a different provider requires implementing its adapter. The terminal remains powered by Binance/Bybit for crypto.

Run `npm test` to verify authentication, market permissions, user management, expiry, session revocation, provider settings and persistence.

When HTTPS is terminated by one trusted reverse proxy, set `TRUST_PROXY=1` so secure session cookies and origin checks use the forwarded protocol. Preserve both `data/auth` and `data/cache` using persistent hosting storage or Docker volumes.

If incoming WebSockets are unavailable on the host, the browser uses authenticated HTTP snapshots every 10 seconds and displays “feed · polling”. WebSocket reconnection continues in the background.

The login screen temporarily offers four testing-account autofill buttons. The server verifies the configured `TEST_ACCOUNT_PASSWORD` (or the original default) against each test account before offering credentials, so live deployments use their configured initial password. Accounts with changed passwords are unavailable. Set `TEST_LOGIN_BUTTONS=false` to remove these public credential shortcuts when testing ends.
