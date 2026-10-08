/**
 * Free research feeds (no API keys):
 *  - alternative.me   Crypto Fear & Greed Index
 *  - DeFiLlama        TVL by chain, stablecoin supply, DEX volume
 *  - GeckoTerminal    trending DEX pools across chains
 *  - blockchain.info  large unconfirmed Bitcoin transactions (on-chain whales)
 */
import { getJSON } from "../../lib/http.js";

export async function fearGreed() {
  const j = await getJSON("https://api.alternative.me/fng/?limit=31", { retries: 1 });
  return (j.data || []).map((x) => ({ value: +x.value, label: x.value_classification, t: +x.timestamp * 1000 })).reverse();
}

export async function defiChains() {
  const [chains, hist] = await Promise.all([
    getJSON("https://api.llama.fi/v2/chains", { retries: 1 }),
    getJSON("https://api.llama.fi/v2/historicalChainTvl", { retries: 1 }),
  ]);
  const top = chains.filter((c) => c.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 12)
    .map((c) => ({ name: c.name, tvlB: c.tvl / 1e9, token: c.tokenSymbol }));
  const h = hist.slice(-31), now = h.at(-1)?.tvl || 0;
  const ago = (n) => h.at(-1 - n)?.tvl || now;
  return {
    totalB: now / 1e9, chg1d: (now / ago(1) - 1) * 100, chg7d: (now / ago(7) - 1) * 100, chg30d: (now / ago(30) - 1) * 100,
    series: h.map((x) => ({ t: x.date * 1000, b: x.tvl / 1e9 })), top,
  };
}

export async function stablecoins() {
  const j = await getJSON("https://stablecoins.llama.fi/stablecoins?includePrices=false", { retries: 1 });
  const rows = (j.peggedAssets || []).map((a) => ({
    name: a.name, symbol: a.symbol, now: a.circulating?.peggedUSD || 0, week: a.circulatingPrevWeek?.peggedUSD || 0, month: a.circulatingPrevMonth?.peggedUSD || 0,
  }));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const total = sum("now");
  return {
    totalB: total / 1e9, chg7d: (total / (sum("week") || total) - 1) * 100, chg30d: (total / (sum("month") || total) - 1) * 100,
    top: rows.sort((a, b) => b.now - a.now).slice(0, 6).map((r) => ({ name: r.name, symbol: r.symbol, b: r.now / 1e9, chg7d: r.week ? (r.now / r.week - 1) * 100 : 0 })),
  };
}

export async function dexVolume() {
  const j = await getJSON("https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true", { retries: 1, timeout: 30000 });
  return {
    total24hB: (j.total24h || 0) / 1e9, chg1d: j.change_1d, total7dB: (j.total7d || 0) / 1e9,
    top: (j.protocols || []).filter((p) => p.total24h).sort((a, b) => b.total24h - a.total24h).slice(0, 8)
      .map((p) => ({ name: p.displayName || p.name, b: p.total24h / 1e9, chg1d: p.change_1d })),
  };
}

export async function trendingPools() {
  const j = await getJSON("https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1", { headers: { Accept: "application/json;version=20230302" }, retries: 1 });
  return (j.data || []).slice(0, 15).map((p) => {
    const a = p.attributes, net = p.id.split("_")[0];
    return {
      name: a.name, network: net, priceUsd: +a.base_token_price_usd, chg24h: +(a.price_change_percentage?.h24 ?? 0),
      vol24h: +(a.volume_usd?.h24 ?? 0), liquidity: +(a.reserve_in_usd ?? 0), fdv: +(a.fdv_usd ?? 0),
      created: a.pool_created_at, url: `https://www.geckoterminal.com/${net}/pools/${a.address}`,
    };
  });
}

/** Unconfirmed BTC transactions moving at least `minBtc` (total outputs, includes change). */
export async function btcWhaleTxs(minBtc) {
  const j = await getJSON("https://blockchain.info/unconfirmed-transactions?format=json", { retries: 0 });
  return (j.txs || []).map((tx) => ({ hash: tx.hash, btc: tx.out.reduce((s, o) => s + (o.value || 0), 0) / 1e8, ts: (tx.time || Date.now() / 1000) * 1000 }))
    .filter((t) => t.btc >= minBtc);
}
