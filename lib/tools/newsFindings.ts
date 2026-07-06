// ---------------------------------------------------------------------------
// News Findings Tool — Red-flag focused search via Tavily
// ---------------------------------------------------------------------------
// Searches specifically for negative signals: lawsuits, layoffs, regulatory
// issues, and leadership changes in the last 12 months.
// Returns structured, categorised findings for the analysis node.
// ---------------------------------------------------------------------------

/** A single red-flag finding */
export interface RedFlagItem {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

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
// Tavily search helper (shared pattern with webResearch.ts)
// ---------------------------------------------------------------------------

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
}

async function tavilySearch(
  query: string,
  maxResults: number = 5
): Promise<{ results: RedFlagItem[]; answer: string; error?: string }> {
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

    const results: RedFlagItem[] = (data.results || []).map((r) => ({
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
 * Returns structured, categorised findings — never throws.
 */
export async function fetchNewsFindings(
  companyName: string
): Promise<NewsFindingsResult> {
  const errors: string[] = [];

  // Define focused search queries
  const queries = {
    lawsuits: `${companyName} lawsuit legal proceedings litigation 2025 2026`,
    layoffs: `${companyName} layoffs workforce reduction restructuring 2025 2026`,
    regulatoryIssues: `${companyName} regulatory investigation compliance SEC fine 2025 2026`,
    leadershipChanges: `${companyName} CEO CFO executive resignation leadership change 2025 2026`,
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

  return {
    lawsuits,
    layoffs,
    regulatoryIssues,
    leadershipChanges,
    overallRiskLevel,
    sources,
    errors,
  };
}
