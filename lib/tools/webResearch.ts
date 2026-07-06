// ---------------------------------------------------------------------------
// Web Research Tool — Tavily Search API wrapper
// ---------------------------------------------------------------------------
// Searches for company overview, recent news, and competitive positioning.
// Returns structured summaries with source URLs for downstream analysis.
// ---------------------------------------------------------------------------

/** A single search result returned by Tavily */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

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
// Tavily API helper
// ---------------------------------------------------------------------------

interface TavilyResponse {
  results: {
    title: string;
    url: string;
    content: string;
    score: number;
  }[];
  answer?: string;
}

/**
 * Performs a single Tavily search query.
 * Returns parsed results or an empty array + error message on failure.
 */
async function tavilySearch(
  query: string,
  maxResults: number = 5
): Promise<{ results: SearchResult[]; answer: string; error?: string }> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      results: [],
      answer: "",
      error: "TAVILY_API_KEY is not set in environment variables",
    };
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        include_answer: true,
        search_depth: "advanced",
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      return {
        results: [],
        answer: "",
        error: `Tavily API error (${response.status}): ${errText}`,
      };
    }

    const data = (await response.json()) as TavilyResponse;

    const results: SearchResult[] = (data.results || []).map((r) => ({
      title: r.title || "Untitled",
      url: r.url || "",
      snippet: r.content?.slice(0, 500) || "",
      score: r.score || 0,
    }));

    return {
      results,
      answer: data.answer || "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      results: [],
      answer: "",
      error: `Tavily request failed: ${message}`,
    };
  }
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
 *   2. Recent news (2025-2026)
 *   3. Competitors & market position
 *
 * Returns structured, typed data — never throws.
 */
export async function webResearch(
  companyName: string
): Promise<WebResearchResult> {
  const errors: string[] = [];

  // Run all three searches in parallel for speed
  const [overviewRes, newsRes, competitorsRes] = await Promise.all([
    tavilySearch(`${companyName} company overview business model`),
    tavilySearch(`${companyName} recent news 2026`),
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

  return {
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
}
