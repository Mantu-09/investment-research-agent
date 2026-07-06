// ---------------------------------------------------------------------------
// Financial Data Tool — Alpha Vantage API wrapper
// ---------------------------------------------------------------------------
// Fetches fundamental company data (OVERVIEW) and real-time quote (GLOBAL_QUOTE)
// from Alpha Vantage. Handles private/unlisted companies gracefully.
// ---------------------------------------------------------------------------

import { fetchWithRetry, sleep } from "../utils/retry";

/** Core financial metrics extracted from Alpha Vantage OVERVIEW */
export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  peRatio: number | null;
  eps: number | null;
  revenueTTM: number | null;
  grossProfitTTM: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  dividendYield: number | null;
  beta: number | null;
  weekHigh52: number | null;
  weekLow52: number | null;
  analystTargetPrice: number | null;
}

/** Real-time quote data from Alpha Vantage GLOBAL_QUOTE */
export interface StockQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  latestTradingDay: string;
  previousClose: number;
  change: number;
  changePercent: string;
}

/** Structured output from the financial data tool */
export interface FinancialDataResult {
  overview: CompanyOverview | null;
  quote: StockQuote | null;
  isPubliclyTraded: boolean;
  note: string;
  sources: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AV_BASE_URL = "https://www.alphavantage.co/query";

/**
 * Safely parse a string value from Alpha Vantage into a number.
 * Returns null for "None", "N/A", "-", empty strings, or NaN.
 */
function safeParseNumber(value: string | undefined | null): number | null {
  if (!value || value === "None" || value === "N/A" || value === "-") {
    return null;
  }
  // Remove trailing % if present
  const cleaned = value.replace(/%$/, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Fetches JSON from Alpha Vantage with error handling.
 * Returns the parsed JSON or null + error message.
 */
async function avFetch(
  params: Record<string, string>
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    return {
      data: null,
      error: "ALPHA_VANTAGE_API_KEY is not set in environment variables",
    };
  }

  const url = new URL(AV_BASE_URL);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetchWithRetry(
      url.toString(),
      undefined,
      { maxRetries: 2, baseDelayMs: 2000 }
    );

    if (!response.ok) {
      return {
        data: null,
        error: `Alpha Vantage API error (${response.status})`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Alpha Vantage returns rate-limit messages inside valid 200 JSON
    if (data["Note"] || data["Information"]) {
      const message =
        (data["Note"] as string) || (data["Information"] as string);
      if (
        message.includes("rate limit") ||
        message.includes("call frequency")
      ) {
        // Wait and return gracefully — Alpha Vantage free tier is very limited
        await sleep(2000);
        return { data: null, error: `Alpha Vantage rate limit: ${message}` };
      }
    }

    // Check for error messages
    if (data["Error Message"]) {
      return {
        data: null,
        error: `Alpha Vantage error: ${data["Error Message"]}`,
      };
    }

    return { data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, error: `Alpha Vantage request failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseOverview(raw: Record<string, unknown>): CompanyOverview | null {
  const symbol = raw["Symbol"] as string | undefined;
  if (!symbol) return null;

  return {
    symbol,
    name: (raw["Name"] as string) || "",
    description: (raw["Description"] as string) || "",
    sector: (raw["Sector"] as string) || "",
    industry: (raw["Industry"] as string) || "",
    marketCap: safeParseNumber(raw["MarketCapitalization"] as string),
    peRatio: safeParseNumber(raw["PERatio"] as string),
    eps: safeParseNumber(raw["EPS"] as string),
    revenueTTM: safeParseNumber(raw["RevenueTTM"] as string),
    grossProfitTTM: safeParseNumber(raw["GrossProfitTTM"] as string),
    profitMargin: safeParseNumber(raw["ProfitMargin"] as string),
    returnOnEquity: safeParseNumber(raw["ReturnOnEquityTTM"] as string),
    dividendYield: safeParseNumber(raw["DividendYield"] as string),
    beta: safeParseNumber(raw["Beta"] as string),
    weekHigh52: safeParseNumber(raw["52WeekHigh"] as string),
    weekLow52: safeParseNumber(raw["52WeekLow"] as string),
    analystTargetPrice: safeParseNumber(raw["AnalystTargetPrice"] as string),
  };
}

function parseQuote(raw: Record<string, unknown>): StockQuote | null {
  const quote = raw["Global Quote"] as Record<string, string> | undefined;
  if (!quote || !quote["01. symbol"]) return null;

  return {
    symbol: quote["01. symbol"],
    price: safeParseNumber(quote["05. price"]) ?? 0,
    open: safeParseNumber(quote["02. open"]) ?? 0,
    high: safeParseNumber(quote["03. high"]) ?? 0,
    low: safeParseNumber(quote["04. low"]) ?? 0,
    volume: safeParseNumber(quote["06. volume"]) ?? 0,
    latestTradingDay: quote["07. latest trading day"] || "",
    previousClose: safeParseNumber(quote["08. previous close"]) ?? 0,
    change: safeParseNumber(quote["09. change"]) ?? 0,
    changePercent: quote["10. change percent"] || "0%",
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches financial data for a company from Alpha Vantage.
 *
 * @param ticker  Stock ticker symbol (e.g. "AAPL", "GOOGL")
 *                If empty or undefined, the company is treated as private.
 *
 * Returns structured financial data — never throws.
 * If the company is private/unlisted, returns null data with a note.
 */
export async function fetchFinancialData(
  ticker: string | undefined
): Promise<FinancialDataResult> {
  const errors: string[] = [];
  const sources: string[] = [];

  // Handle private / unlisted companies
  if (!ticker || ticker.trim() === "") {
    return {
      overview: null,
      quote: null,
      isPubliclyTraded: false,
      note: "Company does not appear to be publicly traded. No stock ticker provided — financial data from public markets is unavailable.",
      sources: [],
      errors: [],
    };
  }

  const cleanTicker = ticker.trim().toUpperCase();

  // Fetch OVERVIEW and GLOBAL_QUOTE in parallel
  const [overviewRes, quoteRes] = await Promise.all([
    avFetch({ function: "OVERVIEW", symbol: cleanTicker }),
    avFetch({ function: "GLOBAL_QUOTE", symbol: cleanTicker }),
  ]);

  // Parse overview
  let overview: CompanyOverview | null = null;
  if (overviewRes.error) {
    errors.push(`Overview: ${overviewRes.error}`);
  } else if (overviewRes.data) {
    overview = parseOverview(overviewRes.data);
    if (!overview) {
      errors.push(
        `No overview data returned for ticker "${cleanTicker}" — it may be delisted or invalid.`
      );
    } else {
      sources.push(
        `Alpha Vantage OVERVIEW (${cleanTicker})`
      );
    }
  }

  // Parse quote
  let quote: StockQuote | null = null;
  if (quoteRes.error) {
    errors.push(`Quote: ${quoteRes.error}`);
  } else if (quoteRes.data) {
    quote = parseQuote(quoteRes.data);
    if (!quote) {
      errors.push(
        `No quote data returned for ticker "${cleanTicker}".`
      );
    } else {
      sources.push(
        `Alpha Vantage GLOBAL_QUOTE (${cleanTicker})`
      );
    }
  }

  const isPubliclyTraded = overview !== null || quote !== null;

  let note = "";
  if (!isPubliclyTraded) {
    note = `Ticker "${cleanTicker}" did not return valid data. The company may be private, delisted, or the ticker may be incorrect.`;
  } else if (errors.length > 0) {
    note = `Partial data retrieved for ${cleanTicker}. Some API calls had errors.`;
  } else {
    note = `Full financial data retrieved for ${cleanTicker}.`;
  }

  return {
    overview,
    quote,
    isPubliclyTraded,
    note,
    sources,
    errors,
  };
}
