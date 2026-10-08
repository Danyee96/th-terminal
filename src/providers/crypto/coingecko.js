/**
 * CoinGecko — market caps, rankings, supply, ATH, global market and trending.
 * Free without a key (low rate limit). For more headroom add a free Demo key:
 * https://www.coingecko.com/en/api → COINGECKO_API_KEY in .env
 */
import { getJSON } from "../../lib/http.js";

const BASE = "https://api.coingecko.com/api/v3";
const headers = () => (process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {});

export async function markets(ids) {
  const url = `${BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&per_page=250&page=1&price_change_percentage=7d,30d`;
  const rows = await getJSON(url, { headers: headers(), retries: 1 });
  return rows.map((r) => ({
    cgId: r.id, image: r.image, rank: r.market_cap_rank, capB: r.market_cap / 1e9, fdvB: r.fully_diluted_valuation / 1e9,
    volB: r.total_volume / 1e9, circ: r.circulating_supply, total: r.total_supply, max: r.max_supply,
    ath: r.ath, athChg: r.ath_change_percentage, athDate: r.ath_date,
  }));
}

export async function global() {
  const j = await getJSON(`${BASE}/global`, { headers: headers(), retries: 1 });
  const d = j.data;
  return {
    capT: d.total_market_cap.usd / 1e12, volB: d.total_volume.usd / 1e9, capChg24h: d.market_cap_change_percentage_24h_usd,
    btcDom: d.market_cap_percentage.btc, ethDom: d.market_cap_percentage.eth, coins: d.active_cryptocurrencies,
  };
}

export async function trending() {
  const j = await getJSON(`${BASE}/search/trending`, { headers: headers(), retries: 1 });
  return (j.coins || []).slice(0, 10).map(({ item: c }) => ({
    id: c.id, name: c.name, symbol: c.symbol, rank: c.market_cap_rank, thumb: c.thumb,
    price: c.data?.price, chg24h: c.data?.price_change_percentage_24h?.usd, url: `https://www.coingecko.com/en/coins/${c.id}`,
  }));
}
