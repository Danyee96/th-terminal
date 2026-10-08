/**
 * Coins the crypto terminal tracks.
 * [symbol, name, category, themes, CoinGecko id]
 * Every symbol must trade against USDT on Binance spot. Add or remove rows freely.
 */
const ROWS = [
  ["BTC", "Bitcoin", "Layer 1", ["Store of value"], "bitcoin"],
  ["ETH", "Ethereum", "Layer 1", ["Smart contracts"], "ethereum"],
  ["SOL", "Solana", "Layer 1", ["Smart contracts"], "solana"],
  ["BNB", "BNB", "Exchange", ["Smart contracts"], "binancecoin"],
  ["XRP", "XRP", "Payments", [], "ripple"],
  ["DOGE", "Dogecoin", "Meme", [], "dogecoin"],
  ["ADA", "Cardano", "Layer 1", ["Smart contracts"], "cardano"],
  ["TRX", "TRON", "Layer 1", ["Smart contracts"], "tron"],
  ["AVAX", "Avalanche", "Layer 1", ["Smart contracts"], "avalanche-2"],
  ["LINK", "Chainlink", "Infrastructure", ["Oracles", "RWA"], "chainlink"],
  ["DOT", "Polkadot", "Layer 1", [], "polkadot"],
  ["SUI", "Sui", "Layer 1", ["Smart contracts"], "sui"],
  ["LTC", "Litecoin", "Payments", [], "litecoin"],
  ["BCH", "Bitcoin Cash", "Payments", [], "bitcoin-cash"],
  ["NEAR", "NEAR Protocol", "Layer 1", ["AI"], "near"],
  ["APT", "Aptos", "Layer 1", [], "aptos"],
  ["ICP", "Internet Computer", "Layer 1", ["AI"], "internet-computer"],
  ["XLM", "Stellar", "Payments", ["RWA"], "stellar"],
  ["HBAR", "Hedera", "Layer 1", ["RWA"], "hedera-hashgraph"],
  ["ATOM", "Cosmos", "Layer 1", [], "cosmos"],
  ["ETC", "Ethereum Classic", "Layer 1", [], "ethereum-classic"],
  ["SEI", "Sei", "Layer 1", [], "sei-network"],
  ["ARB", "Arbitrum", "Layer 2", [], "arbitrum"],
  ["OP", "Optimism", "Layer 2", [], "optimism"],
  ["POL", "Polygon", "Layer 2", [], "polygon-ecosystem-token"],
  ["UNI", "Uniswap", "DeFi", ["DEX"], "uniswap"],
  ["AAVE", "Aave", "DeFi", ["Lending"], "aave"],
  ["ENA", "Ethena", "DeFi", ["Stablecoins"], "ethena"],
  ["LDO", "Lido DAO", "DeFi", ["Staking"], "lido-dao"],
  ["INJ", "Injective", "DeFi", ["Perps DEX"], "injective-protocol"],
  ["JUP", "Jupiter", "DeFi", ["DEX"], "jupiter-exchange-solana"],
  ["PENDLE", "Pendle", "DeFi", ["Yield"], "pendle"],
  ["CRV", "Curve DAO", "DeFi", ["DEX"], "curve-dao-token"],
  ["ONDO", "Ondo", "DeFi", ["RWA"], "ondo-finance"],
  ["TAO", "Bittensor", "AI", ["AI"], "bittensor"],
  ["RENDER", "Render", "AI", ["AI", "DePIN"], "render-token"],
  ["FET", "Artificial Superintelligence Alliance", "AI", ["AI"], "fetch-ai"],
  ["VIRTUAL", "Virtuals Protocol", "AI", ["AI", "Agents"], "virtual-protocol"],
  ["WLD", "Worldcoin", "AI", ["AI"], "worldcoin-wld"],
  ["FIL", "Filecoin", "Infrastructure", ["DePIN"], "filecoin"],
  ["TIA", "Celestia", "Infrastructure", ["Modular"], "celestia"],
  ["PEPE", "Pepe", "Meme", [], "pepe"],
  ["SHIB", "Shiba Inu", "Meme", [], "shiba-inu"],
  ["WIF", "dogwifhat", "Meme", ["Solana memes"], "dogwifcoin"],
  ["BONK", "Bonk", "Meme", ["Solana memes"], "bonk"],
  ["TRUMP", "Official Trump", "Meme", ["Solana memes"], "official-trump"],
];

export const COINS = ROWS.map(([tk, name, sector, themes, cgId]) => ({ tk, name, sector, themes, cgId, pair: `${tk}USDT` }));
export const CATEGORIES = ["Layer 1", "Layer 2", "DeFi", "AI", "Payments", "Exchange", "Infrastructure", "Meme"];
export const CRYPTO_THEMES = ["AI", "RWA", "DePIN", "Perps DEX", "DEX", "Solana memes", "Smart contracts", "Staking"];
