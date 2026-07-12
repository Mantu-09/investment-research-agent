// ---------------------------------------------------------------------------
// News Findings Tool — Red-flag focused search via Tavily
// ---------------------------------------------------------------------------
// Searches specifically for negative signals: lawsuits, layoffs, regulatory
// issues, and leadership changes in the last 12 months.
// Returns structured, categorised findings for the analysis node.
// ---------------------------------------------------------------------------

import { tavilySearch } from "../utils/tavily";
import type { TavilySearchResult } from "../utils/tavily";

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
const newsFindingsCache = new Map<string, CacheEntry<NewsFindingsResult>>();

function getCached(key: string): NewsFindingsResult | null {
  const entry = newsFindingsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    newsFindingsCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: NewsFindingsResult): void {
  newsFindingsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** A single red-flag finding */
export type RedFlagItem = TavilySearchResult;

/** Categories of risk signals */
export interface RedFlagCategory {
  query: string;
  results: RedFlagItem[];
  summary: string;
}

/** Structured output from the news findings tool */
export interface NewsFindingsResult {
  lawsuits: RedFlagCategory;
  layoffs: RedFlagCategory;
  regulatoryIssues: RedFlagCategory;
  leadershipChanges: RedFlagCategory;
  overallRiskLevel: "low" | "medium" | "high";
  sources: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCategory(
  query: string,
  results: RedFlagItem[],
  answer: string,
  fallback: string
): RedFlagCategory {
  return {
    query,
    results,
    summary:
      answer ||
      (results.length > 0
        ? results
            .map((r) => `• ${r.title}: ${r.snippet}`)
            .join("\n")
            .slice(0, 1500)
        : fallback),
  };
}

/**
 * Heuristic risk scoring based on how many categories returned results
 * and the total number of red-flag items found.
 */
function assessRiskLevel(
  categories: RedFlagCategory[]
): "low" | "medium" | "high" {
  const categoriesWithResults = categories.filter(
    (c) => c.results.length > 0
  ).length;
  const totalItems = categories.reduce(
    (sum, c) => sum + c.results.length,
    0
  );

  if (categoriesWithResults >= 3 || totalItems >= 10) return "high";
  if (categoriesWithResults >= 2 || totalItems >= 5) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Performs targeted searches for red-flag signals about a company:
 *   1. Lawsuits & legal proceedings
 *   2. Layoffs & workforce reductions
 *   3. Regulatory investigations & compliance issues
 *   4. Executive & leadership changes
 *
 * Results are cached in-memory for 6 hours per company name (best-effort;
 * resets on cold starts in serverless environments).
 *
 * Returns structured, categorised findings — never throws.
 */
export async function fetchNewsFindings(
  companyName: string
): Promise<NewsFindingsResult> {
  // Normalise cache key to lowercase trimmed name
  const cacheKey = companyName.trim().toLowerCase();

  // Return cached result if available and fresh
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[fetchNewsFindings] Cache HIT for "${companyName}" — skipping Tavily calls`);
    return cached;
  }

  const errors: string[] = [];

  // Use current year dynamically so queries don't age stale
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;
  const yearRange = `${prevYear} ${currentYear}`;

  // Define focused search queries with dynamic year range
  const queries = {
    lawsuits: `${companyName} lawsuit legal proceedings litigation ${yearRange}`,
    layoffs: `${companyName} layoffs workforce reduction restructuring ${yearRange}`,
    regulatoryIssues: `${companyName} regulatory investigation compliance SEC fine ${yearRange}`,
    leadershipChanges: `${companyName} CEO CFO executive resignation leadership change ${yearRange}`,
  };

  // Run all four searches in parallel
  const [lawsuitsRes, layoffsRes, regulatoryRes, leadershipRes] =
    await Promise.all([
      tavilySearch(queries.lawsuits),
      tavilySearch(queries.layoffs),
      tavilySearch(queries.regulatoryIssues),
      tavilySearch(queries.leadershipChanges),
    ]);

  // Collect errors
  if (lawsuitsRes.error) errors.push(`Lawsuits search: ${lawsuitsRes.error}`);
  if (layoffsRes.error) errors.push(`Layoffs search: ${layoffsRes.error}`);
  if (regulatoryRes.error)
    errors.push(`Regulatory search: ${regulatoryRes.error}`);
  if (leadershipRes.error)
    errors.push(`Leadership search: ${leadershipRes.error}`);

  // Build structured categories
  const lawsuits = buildCategory(
    queries.lawsuits,
    lawsuitsRes.results,
    lawsuitsRes.answer,
    `No recent lawsuits or legal issues found for ${companyName}`
  );

  const layoffs = buildCategory(
    queries.layoffs,
    layoffsRes.results,
    layoffsRes.answer,
    `No recent layoffs or workforce reductions found for ${companyName}`
  );

  const regulatoryIssues = buildCategory(
    queries.regulatoryIssues,
    regulatoryRes.results,
    regulatoryRes.answer,
    `No recent regulatory issues found for ${companyName}`
  );

  const leadershipChanges = buildCategory(
    queries.leadershipChanges,
    leadershipRes.results,
    leadershipRes.answer,
    `No recent leadership changes found for ${companyName}`
  );

  // Deduplicate source URLs
  const allUrls = [
    ...lawsuitsRes.results,
    ...layoffsRes.results,
    ...regulatoryRes.results,
    ...leadershipRes.results,
  ].map((r) => r.url);
  const sources = Array.from(new Set(allUrls)).filter(Boolean);

  // Assess overall risk
  const overallRiskLevel = assessRiskLevel([
    lawsuits,
    layoffs,
    regulatoryIssues,
    leadershipChanges,
  ]);

  const result: NewsFindingsResult = {
    lawsuits,
    layoffs,
    regulatoryIssues,
    leadershipChanges,
    overallRiskLevel,
    sources,
    errors,
  };

  // Store in cache before returning
  setCached(cacheKey, result);
  console.log(`[fetchNewsFindings] Cache SET for "${companyName}" (TTL: 6h)`);

  return result;
}
