/**
 * The stocks the terminal tracks.
 * [ticker, company, sector, themes, fallback market cap ($B), fallback price]
 * Fallback values are only used if the data provider can't supply them
 * (market cap) or in simulated mode (price). Add or remove rows freely.
 */
const ROWS = [
  ["NVDA", "Nvidia", "Semiconductors", ["AI"], 4300, 180], ["AVGO", "Broadcom", "Semiconductors", ["AI"], 1500, 320],
  ["TSM", "Taiwan Semiconductor", "Semiconductors", ["AI"], 1200, 240], ["AMD", "Advanced Micro Devices", "Semiconductors", ["AI"], 260, 160],
  ["ASML", "ASML Holding", "Semiconductors", [], 290, 740], ["QCOM", "Qualcomm", "Semiconductors", [], 180, 160],
  ["MU", "Micron", "Semiconductors", ["AI"], 160, 140], ["ARM", "Arm Holdings", "Semiconductors", ["AI"], 160, 150], ["INTC", "Intel", "Semiconductors", [], 100, 23],
  ["MSFT", "Microsoft", "Software", ["AI"], 3800, 510], ["ORCL", "Oracle", "Software", ["AI"], 700, 250], ["PLTR", "Palantir", "Software", ["AI"], 380, 160],
  ["CRM", "Salesforce", "Software", ["AI"], 240, 250], ["NOW", "ServiceNow", "Software", ["AI"], 190, 920], ["ADBE", "Adobe", "Software", [], 150, 350],
  ["CRWD", "CrowdStrike", "Software", [], 110, 440], ["SNOW", "Snowflake", "Software", ["AI"], 70, 210],
  ["AAPL", "Apple", "Technology", [], 3500, 235], ["DELL", "Dell Technologies", "Technology", ["AI"], 90, 130], ["SMCI", "Super Micro Computer", "Technology", ["AI"], 28, 45],
  ["GOOGL", "Alphabet", "Communication", ["AI"], 2700, 225], ["META", "Meta Platforms", "Communication", ["AI"], 1900, 760], ["NFLX", "Netflix", "Communication", [], 520, 1220],
  ["DIS", "Walt Disney", "Communication", [], 210, 115], ["T", "AT&T", "Communication", [], 200, 28], ["VZ", "Verizon", "Communication", [], 180, 43],
  ["AMZN", "Amazon", "Consumer", ["AI"], 2400, 225], ["TSLA", "Tesla", "Consumer", ["AI", "EV"], 1100, 340], ["WMT", "Walmart", "Consumer", [], 820, 102],
  ["COST", "Costco", "Consumer", [], 420, 940], ["HD", "Home Depot", "Consumer", [], 400, 400], ["MCD", "McDonald's", "Consumer", [], 220, 300],
  ["NKE", "Nike", "Consumer", [], 110, 72], ["SBUX", "Starbucks", "Consumer", [], 100, 88],
  ["BRK.B", "Berkshire Hathaway", "Financials", [], 1050, 490], ["JPM", "JPMorgan Chase", "Financials", [], 820, 300],
  ["V", "Visa", "Financials", ["Fintech"], 680, 345], ["MA", "Mastercard", "Financials", ["Fintech"], 530, 570],
  ["BAC", "Bank of America", "Financials", [], 360, 48], ["MS", "Morgan Stanley", "Financials", [], 230, 145], ["GS", "Goldman Sachs", "Financials", [], 220, 720],
  ["HOOD", "Robinhood", "Financials", ["Fintech", "Crypto"], 90, 110], ["COIN", "Coinbase", "Financials", ["Fintech", "Crypto"], 85, 330],
  ["PYPL", "PayPal", "Financials", ["Fintech"], 70, 70], ["XYZ", "Block", "Financials", ["Fintech", "Crypto"], 45, 75],
  ["SOFI", "SoFi Technologies", "Financials", ["Fintech"], 28, 25], ["AFRM", "Affirm", "Financials", ["Fintech"], 25, 80],
  ["LLY", "Eli Lilly", "Healthcare", [], 720, 800], ["JNJ", "Johnson & Johnson", "Healthcare", [], 400, 165], ["ABBV", "AbbVie", "Healthcare", [], 350, 200],
  ["UNH", "UnitedHealth", "Healthcare", [], 280, 310], ["MRK", "Merck", "Healthcare", [], 210, 84], ["ISRG", "Intuitive Surgical", "Healthcare", ["AI"], 170, 470],
  ["PFE", "Pfizer", "Healthcare", [], 140, 24],
  ["XOM", "Exxon Mobil", "Energy", [], 470, 110], ["CVX", "Chevron", "Energy", [], 270, 155], ["NEE", "NextEra Energy", "Energy", ["Clean energy"], 150, 72],
  ["COP", "ConocoPhillips", "Energy", [], 120, 95], ["SLB", "SLB", "Energy", [], 50, 35], ["OXY", "Occidental", "Energy", [], 45, 45],
  ["FSLR", "First Solar", "Energy", ["Clean energy"], 22, 200],
  ["GE", "GE Aerospace", "Industrials", ["Defense"], 290, 270], ["CAT", "Caterpillar", "Industrials", [], 200, 420], ["BA", "Boeing", "Industrials", ["Defense"], 165, 220],
  ["HON", "Honeywell", "Industrials", [], 140, 215], ["LMT", "Lockheed Martin", "Industrials", ["Defense"], 110, 460], ["RTX", "RTX", "Industrials", ["Defense"], 210, 160],
  ["UPS", "UPS", "Industrials", [], 75, 88],
];

export const UNIVERSE = ROWS.map(([tk, name, sector, themes, capB, price]) => ({ tk, name, sector, themes, capB, price }));
export const SECTORS = ["Semiconductors", "Software", "Technology", "Communication", "Consumer", "Financials", "Healthcare", "Energy", "Industrials"];
export const THEMES = ["AI", "Fintech", "Crypto", "Defense", "Clean energy", "EV"];
