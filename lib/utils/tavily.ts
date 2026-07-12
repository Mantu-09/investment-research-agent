// ---------------------------------------------------------------------------
// Shared Tavily Search Helper
// ---------------------------------------------------------------------------
// Single source of truth for all Tavily API calls across the agent tools.
// Previously duplicated between webResearch.ts and newsFindings.ts.
// ---------------------------------------------------------------------------

import { fetchWithRetry } from "./retry";

// ── Types ──────────────────────────────────────────────────────────────────

interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyRawResult[];
  answer?: string;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  /** First 500 characters of the result content */
  snippet: string;
  score: number;
}

export interface TavilySearchOutput {
  results: TavilySearchResult[];
  answer: string;
  error?: string;
}

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Performs a single Tavily web search query.
 *
 * @param query      The search string to send to Tavily.
 * @param maxResults Maximum results to request (default: 5).
 *
 * Returns parsed results and an optional Tavily-generated answer summary.
 * Never throws — errors are returned in the `error` field.
 */
export async function tavilySearch(
  query: string,
  maxResults: number = 5
): Promise<TavilySearchOutput> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      results: [],
      answer: "",
      error: "TAVILY_API_KEY is not set in environment variables",
    };
  }

  try {
    const response = await fetchWithRetry(
      "https://api.tavily.com/search",
      {
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
      },
      { maxRetries: 2, baseDelayMs: 1500 }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      return {
        results: [],
        answer: "",
        error: `Tavily API error (${response.status}): ${errText}`,
      };
    }

    const data = (await response.json()) as TavilyResponse;

    const results: TavilySearchResult[] = (data.results || []).map((r) => ({
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
