// ---------------------------------------------------------------------------
// Web Research Tool — Tavily Search API wrapper
// ---------------------------------------------------------------------------
// Searches for company overview, recent news, and competitive positioning.
// Returns structured summaries with source URLs for downstream analysis.
// ---------------------------------------------------------------------------

import { tavilySearch } from "../utils/tavily";

// ---------------------------------------------------------------------------
// In-memory result cache (TTL: 6 hours)
// ---------------------------------------------------------------------------
// NOTE: This is a best-effort cache for demo purposes. Because this app runs
// in a serverless environment (Vercel), each cold start resets the Map —
// the cache only benefits repeated calls WITHIN the same warm function
// instance. It does not persist across deployments or cold starts. A Redis/KV
// store would be required for true persistence, but this is intentionally
// kept simple to avoid adding infrastructure dependencies.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix timestamp ms
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const webResearchCache = new Map<string, CacheEntry<WebResearchResult>>();

function getCached(key: string): WebResearchResult | null {
  const entry = webResearchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    webResearchCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: WebResearchResult): void {
  webResearchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** A single search result returned by Tavily */
export type SearchResult = import("../utils/tavily").TavilySearchResult;

/** Structured output from the web research tool */
export interface WebResearchResult {
  companyOverview: {
    results: SearchResult[];
    summary: string;
  };
  recentNews: {
    results: SearchResult[];
    summary: string;
  };
  competitivePosition: {
    results: SearchResult[];
    summary: string;
  };
  sources: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Summarisation helper
// ---------------------------------------------------------------------------

function summariseResults(results: SearchResult[], fallback: string): string {
  if (results.length === 0) return fallback;
  return results
    .map((r) => `• ${r.title}: ${r.snippet}`)
    .join("\n")
    .slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Performs three parallel web searches to gather a broad picture of a company:
 *   1. Business overview & model
 *   2. Recent news (current year)
 *   3. Competitors & market position
 *
 * Results are cached in-memory for 6 hours per company name (best-effort;
 * resets on cold starts in serverless environments).
 *
 * Returns structured, typed data — never throws.
 */
export async function webResearch(
  companyName: string
): Promise<WebResearchResult> {
  // Normalise cache key to lowercase trimmed name
  const cacheKey = companyName.trim().toLowerCase();

  // Return cached result if available and fresh
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[webResearch] Cache HIT for "${companyName}" — skipping Tavily calls`);
    return cached;
  }

  const errors: string[] = [];
  // Use current year dynamically so queries don't age stale
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  // Run all three searches in parallel for speed
  const [overviewRes, newsRes, competitorsRes] = await Promise.all([
    tavilySearch(`${companyName} company overview business model`),
    tavilySearch(`${companyName} recent news ${prevYear} ${currentYear}`),
    tavilySearch(`${companyName} competitors market position`),
  ]);

  // Collect any errors
  if (overviewRes.error) errors.push(`Overview search: ${overviewRes.error}`);
  if (newsRes.error) errors.push(`News search: ${newsRes.error}`);
  if (competitorsRes.error)
    errors.push(`Competitors search: ${competitorsRes.error}`);

  // Deduplicate all source URLs
  const allUrls = [
    ...overviewRes.results,
    ...newsRes.results,
    ...competitorsRes.results,
  ].map((r) => r.url);
  const sources = Array.from(new Set(allUrls)).filter(Boolean);

  const result: WebResearchResult = {
    companyOverview: {
      results: overviewRes.results,
      summary:
        overviewRes.answer ||
        summariseResults(
          overviewRes.results,
          `No overview data found for ${companyName}`
        ),
    },
    recentNews: {
      results: newsRes.results,
      summary:
        newsRes.answer ||
        summariseResults(
          newsRes.results,
          `No recent news found for ${companyName}`
        ),
    },
    competitivePosition: {
      results: competitorsRes.results,
      summary:
        competitorsRes.answer ||
        summariseResults(
          competitorsRes.results,
          `No competitive data found for ${companyName}`
        ),
    },
    sources,
    errors,
  };

  // Store in cache before returning
  setCached(cacheKey, result);
  console.log(`[webResearch] Cache SET for "${companyName}" (TTL: 6h)`);

  return result;
}
