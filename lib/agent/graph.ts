import { StateGraph, START, END } from "@langchain/langgraph";
import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { AgentState, type AgentStateType, type InvestmentDecision } from "./state";
import { webResearch } from "../tools/webResearch";
import { fetchFinancialData } from "../tools/financialData";
import { fetchNewsFindings } from "../tools/newsFindings";
import { withRetry } from "../utils/retry";

// ---------------------------------------------------------------------------
// Investment Research Agent — Graph Definition (Phase 3)
// ---------------------------------------------------------------------------
// Wiring:
//   START → research → (conditional) → analyze → decide → format → END
//
// The conditional edge after "research" uses the LLM to judge data sufficiency.
// If insufficient and iterationCount < 3, loops back to research.
// ---------------------------------------------------------------------------

// ── LLM instance (lazy) ────────────────────────────────────────────────────
// Instantiated on first call, NOT at module load time.
// This prevents next build from crashing when GROQ_API_KEY is not in the
// build environment — the key is only required at request time.

let _llm: ChatGroq | null = null;
function getLLM(): ChatGroq {
  if (!_llm) {
    _llm = new ChatGroq({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      maxTokens: 4096,
    });
  }
  return _llm;
}

// ── Zod schema for the investment decision ─────────────────────────────────

const DecisionSchema = z.object({
  verdict: z.enum(["invest", "pass"]),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  keyRisks: z.array(z.string()),
  sources: z.array(z.string()),
});

// ── Helper: extract JSON from LLM output ───────────────────────────────────

/**
 * Extracts a JSON object from an LLM response that may contain markdown
 * code fences or surrounding text.
 */
function extractJSON(text: string): string {
  // Try to extract from code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find raw JSON object — use a balanced brace approach
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0].trim();

  return text.trim();
}

/**
 * Wraps getLLM().invoke() with retry logic for Groq rate limits.
 * Groq free tier: 30 req/min, 6000 tokens/min.
 */
async function invokeLLM(
  messages: (SystemMessage | HumanMessage)[]
): Promise<string> {
  const result = await withRetry(
    async () => {
      const res = await getLLM().invoke(messages);
      return typeof res.content === "string" ? res.content : String(res.content);
    },
    { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 15000 }
  );
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// NODE 1: RESEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Research node — calls all three research tools in parallel, appends results
 * to researchNotes and newsFindings, populates financialData, and increments
 * iterationCount.
 */
const researchNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  const company = state.companyName;
  const iteration = state.iterationCount + 1;

  console.log(`[Research] Iteration ${iteration} for "${company}"...`);

  // Run all three tools in parallel
  const [webResults, financialResults, newsResults] = await Promise.all([
    webResearch(company),
    fetchFinancialData(company), // uses company name as potential ticker
    fetchNewsFindings(company),
  ]);

  // ── Build research notes ──────────────────────────────────────────────

  const notes: string[] = [];

  // Web research notes
  if (webResults.companyOverview.summary) {
    notes.push(`[Web Research - Overview] ${webResults.companyOverview.summary}`);
  }
  if (webResults.recentNews.summary) {
    notes.push(`[Web Research - Recent News] ${webResults.recentNews.summary}`);
  }
  if (webResults.competitivePosition.summary) {
    notes.push(
      `[Web Research - Competition] ${webResults.competitivePosition.summary}`
    );
  }

  // Financial data notes
  if (financialResults.overview) {
    const ov = financialResults.overview;
    notes.push(
      `[Financial Data - Overview] ${ov.name} (${ov.symbol}) | ` +
        `Sector: ${ov.sector} | Industry: ${ov.industry} | ` +
        `Market Cap: ${ov.marketCap ? "$" + (ov.marketCap / 1e9).toFixed(2) + "B" : "N/A"} | ` +
        `P/E: ${ov.peRatio ?? "N/A"} | EPS: ${ov.eps ?? "N/A"} | ` +
        `Revenue TTM: ${ov.revenueTTM ? "$" + (ov.revenueTTM / 1e9).toFixed(2) + "B" : "N/A"} | ` +
        `Profit Margin: ${ov.profitMargin ? (ov.profitMargin * 100).toFixed(1) + "%" : "N/A"} | ` +
        `ROE: ${ov.returnOnEquity ? (ov.returnOnEquity * 100).toFixed(1) + "%" : "N/A"} | ` +
        `Beta: ${ov.beta ?? "N/A"}`
    );
    if (ov.description) {
      notes.push(`[Financial Data - Description] ${ov.description}`);
    }
  }

  if (financialResults.quote) {
    const q = financialResults.quote;
    notes.push(
      `[Financial Data - Quote] ${q.symbol} Price: $${q.price.toFixed(2)} | ` +
        `Change: ${q.changePercent} | Volume: ${q.volume.toLocaleString()} | ` +
        `52W Range: (from overview data)`
    );
  }

  if (!financialResults.isPubliclyTraded) {
    notes.push(`[Financial Data - Note] ${financialResults.note}`);
  }

  // Log errors from tools (append as notes so the LLM is aware)
  const allErrors = [
    ...webResults.errors,
    ...financialResults.errors,
    ...newsResults.errors,
  ];
  if (allErrors.length > 0) {
    notes.push(
      `[Tool Errors] The following data-gathering errors occurred: ${allErrors.join("; ")}`
    );
  }

  // ── Build news findings ───────────────────────────────────────────────

  const newsItems: string[] = [];

  if (newsResults.lawsuits.results.length > 0) {
    newsItems.push(`[Lawsuits] ${newsResults.lawsuits.summary}`);
  }
  if (newsResults.layoffs.results.length > 0) {
    newsItems.push(`[Layoffs] ${newsResults.layoffs.summary}`);
  }
  if (newsResults.regulatoryIssues.results.length > 0) {
    newsItems.push(`[Regulatory] ${newsResults.regulatoryIssues.summary}`);
  }
  if (newsResults.leadershipChanges.results.length > 0) {
    newsItems.push(`[Leadership] ${newsResults.leadershipChanges.summary}`);
  }
  newsItems.push(
    `[Risk Assessment] Overall risk level: ${newsResults.overallRiskLevel.toUpperCase()}`
  );

  // ── Build financial data object ───────────────────────────────────────

  const financialData: Record<string, unknown> = {
    overview: financialResults.overview,
    quote: financialResults.quote,
    isPubliclyTraded: financialResults.isPubliclyTraded,
    note: financialResults.note,
    sources: financialResults.sources,
    riskLevel: newsResults.overallRiskLevel,
  };

  // Collect all source URLs
  const allSources = [
    ...webResults.sources,
    ...financialResults.sources,
    ...newsResults.sources,
  ];
  if (allSources.length > 0) {
    notes.push(
      `[Sources] ${Array.from(new Set(allSources)).join(", ")}`
    );
  }

  return {
    researchNotes: notes,
    newsFindings: newsItems,
    financialData,
    iterationCount: iteration,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// CONDITIONAL EDGE: SUFFICIENCY CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uses the LLM to judge whether accumulated research data is sufficient
 * to make an investment recommendation. Returns "research" to loop or
 * "analyze" to proceed.
 */
const shouldContinueResearch = async (
  state: AgentStateType
): Promise<string> => {
  // Hard cap: always proceed after 3 iterations
  if (state.iterationCount >= 3) {
    console.log("[Sufficiency] Max iterations reached — proceeding to analysis.");
    return "analyze";
  }

  // If we have no research notes at all, definitely need more research
  if (state.researchNotes.length === 0) {
    console.log("[Sufficiency] No data gathered yet — continuing research.");
    return "research";
  }

  // Ask the LLM to judge sufficiency
  const notesSummary = state.researchNotes.join("\n").slice(0, 6000);
  const newsSnippet = state.newsFindings.join("\n").slice(0, 2000);

  try {
    const response = await invokeLLM([
      new SystemMessage(
        `You are a research quality assessor for an investment research agent.
Your job is to determine whether we have gathered ENOUGH information to make a well-reasoned investment recommendation for a company.

You need AT LEAST the following to say data is sufficient:
1. A clear understanding of what the company does (business model)
2. Some financial metrics OR a clear note that the company is private
3. Awareness of recent news or confirmation that no significant news exists
4. Competitive landscape context

Respond with EXACTLY one line in this format:
SUFFICIENT: yes|no — <brief one-line reason>

Examples:
SUFFICIENT: yes — We have business model, financials, news, and competitor data.
SUFFICIENT: no — Missing competitive landscape data. Try searching for "${state.companyName} competitors market share 2026".`
      ),
      new HumanMessage(
        `Company: ${state.companyName}
Iteration: ${state.iterationCount} of 3

Research Notes Gathered:
${notesSummary}

News Findings:
${newsSnippet}

Financial Data Available: ${state.financialData ? "Yes" : "No"}

Is there enough data to make a well-reasoned investment recommendation?`
      ),
    ]);

    console.log(`[Sufficiency] LLM response: ${response.trim()}`);

    if (response.toLowerCase().includes("sufficient: yes")) {
      return "analyze";
    }

    return "research";
  } catch (err) {
    // If the LLM call fails, proceed to analysis with what we have
    console.error(
      "[Sufficiency] LLM call failed, proceeding with available data:",
      err
    );
    return "analyze";
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// NODE 2: ANALYZE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze node — prompts the LLM to synthesize all gathered research into
 * a structured analysis covering business model, financial health, market
 * position, and risk factors.
 */
const analyzeNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  console.log("[Analyze] Synthesizing research data...");

  const notesSummary = state.researchNotes.join("\n").slice(0, 8000);
  const newsSnippet = state.newsFindings.join("\n").slice(0, 3000);
  const financialSnippet = state.financialData
    ? JSON.stringify(state.financialData, null, 2).slice(0, 3000)
    : "No financial data available (company may be private).";

  try {
    const analysis = await invokeLLM([
      new SystemMessage(
        `You are a senior investment analyst. Your task is to produce a thorough, evidence-based analysis of a company based ONLY on the research data provided below.

CRITICAL RULES:
- Base every claim on specific evidence from the research notes — cite which finding you are referencing.
- Do NOT invent or assume facts not present in the data.
- Do NOT fabricate financial figures. ONLY use numbers that appear verbatim in the FINANCIAL DATA section below.
- If data is missing or uncertain, explicitly say "Data not available" — never guess.
- If financial data is null/empty, state "No public financial data was retrieved" and do NOT invent P/E, market cap, or revenue numbers.
- Be balanced: present both strengths and weaknesses.

Structure your analysis with these exact sections:

## Business Model
Describe what the company does, its revenue streams, and value proposition based on the research.

## Financial Health
Analyze the financial metrics. Comment on valuation (P/E), profitability (margins), growth (revenue trends), and balance sheet health. If the company is private OR the financial data section below says "No financial data available", explicitly note that and do NOT invent numbers.

## Market Position
Evaluate the company's competitive standing, market share, and key competitors based on the research findings.

## Risk Factors
List specific, evidence-backed risks. For each risk, cite the specific research finding that surfaced it. Include:
- Legal/regulatory risks (from news findings)
- Financial risks (from financial data)
- Competitive risks (from market research)
- Operational risks (from any source)

## Key Strengths
List the company's strongest positive attributes based on the evidence.

Write in a professional, analytical tone suitable for an institutional investor.`
      ),
      new HumanMessage(
        `Company: ${state.companyName}

=== RESEARCH NOTES ===
${notesSummary}

=== NEWS FINDINGS ===
${newsSnippet}

=== FINANCIAL DATA ===
${financialSnippet}

Please produce your structured analysis now.`
      ),
    ]);

    console.log("[Analyze] Analysis complete.");
    return { analysis };
  } catch (err) {
    console.error("[Analyze] LLM call failed:", err);
    return {
      analysis:
        `Analysis could not be completed due to an LLM error. ` +
        `Raw research notes are available for manual review.\n\n` +
        `Research summary: ${state.researchNotes.length} notes gathered, ` +
        `${state.newsFindings.length} news items found.`,
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// NODE 3: DECIDE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide node — prompts the LLM to output a strict JSON investment decision
 * matching the InvestmentDecision schema. Uses Zod to validate the output
 * and retries once on parse failure.
 */
const decideNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  console.log("[Decide] Generating investment decision...");

  // Gather all source URLs from the research
  const allSources = state.researchNotes
    .filter((n) => n.startsWith("[Sources]"))
    .flatMap((n) => n.replace("[Sources] ", "").split(", "))
    .filter(Boolean);

  const decisionPrompt = `You are a senior investment analyst making a final investment recommendation.

Based EXCLUSIVELY on the analysis below, produce a JSON investment decision.

CRITICAL RULES:
- Your verdict MUST be grounded in the analysis — do not give generic advice.
- Each key risk must cite the specific evidence from the analysis that supports it.
- Confidence should reflect how much quality data was available:
  - 80-100: Comprehensive data, clear signal
  - 60-79: Good data but some gaps
  - 40-59: Mixed signals or moderate data gaps
  - 20-39: Significant data gaps
  - 0-19: Very limited data, low confidence in any conclusion
- Sources should list the actual URLs or data sources used in the research.

Respond with ONLY a JSON object (no markdown, no explanation) matching this exact schema:
{
  "verdict": "invest" | "pass",
  "confidence": <number 0-100>,
  "reasoning": "<2-4 sentence explanation citing specific evidence>",
  "keyRisks": ["<risk 1 citing specific finding>", "<risk 2>", ...],
  "sources": ["<source URL or name>", ...]
}`;

  const attemptDecision = async (retryHint?: string): Promise<InvestmentDecision | null> => {
    try {
      const messages = [
        new SystemMessage(decisionPrompt),
        new HumanMessage(
          `Company: ${state.companyName}

=== ANALYSIS ===
${(state.analysis || "No analysis available.").slice(0, 8000)}

=== AVAILABLE SOURCES ===
${allSources.slice(0, 20).join("\n") || "No source URLs collected."}
${retryHint ? `\n\n=== RETRY NOTE ===\n${retryHint}` : ""}`
        ),
      ];

      const rawContent = await invokeLLM(messages);

      const jsonStr = extractJSON(rawContent);
      const parsed = JSON.parse(jsonStr);
      const validated = DecisionSchema.safeParse(parsed);

      if (validated.success) {
        return validated.data as InvestmentDecision;
      }

      console.warn("[Decide] Zod validation failed:", validated.error);
      return null;
    } catch (err) {
      console.error("[Decide] Parse/invoke error:", err);
      return null;
    }
  };

  // First attempt
  let decision = await attemptDecision();

  // Retry once with a hint if parsing failed
  if (!decision) {
    console.log("[Decide] First attempt failed — retrying with hint...");
    decision = await attemptDecision(
      "Your previous response could not be parsed as valid JSON. " +
      "Please respond with ONLY a raw JSON object, no markdown code fences, " +
      "no explanation text. The JSON must have exactly these fields: " +
      'verdict (string: "invest" or "pass"), confidence (number 0-100), ' +
      "reasoning (string), keyRisks (array of strings), sources (array of strings)."
    );
  }

  // Fallback if both attempts fail
  if (!decision) {
    console.error("[Decide] Both attempts failed — using fallback decision.");
    decision = {
      verdict: "pass",
      confidence: 10,
      reasoning:
        `Unable to generate a structured decision due to LLM parsing errors. ` +
        `Based on the ${state.researchNotes.length} research notes gathered, ` +
        `a conservative "pass" recommendation is issued pending manual review.`,
      keyRisks: [
        "Automated analysis could not be completed — manual review required",
        `Data quality: ${state.researchNotes.length} research notes, ${state.newsFindings.length} news items gathered`,
      ],
      sources: allSources.slice(0, 10),
    };
  }

  console.log(
    `[Decide] Verdict: ${decision.verdict} (confidence: ${decision.confidence}%)`
  );

  return { decision };
};

// ═══════════════════════════════════════════════════════════════════════════
// NODE 4: FORMAT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format node — assembles the final state into a clean response object.
 * This is the last node before END; the returned state is what the API
 * sends back to the client.
 */
const formatNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  console.log("[Format] Assembling final response...");

  // The state already has all the data in structured form.
  // This node ensures the analysis and decision are cleaned up and complete.

  const formattedAnalysis = [
    `# Investment Research Report: ${state.companyName}`,
    ``,
    `*Research iterations: ${state.iterationCount} | ` +
      `Data points: ${state.researchNotes.length} notes, ` +
      `${state.newsFindings.length} news findings*`,
    ``,
    `---`,
    ``,
    state.analysis || "No analysis was generated.",
    ``,
    `---`,
    ``,
    `## Investment Decision`,
    ``,
    state.decision
      ? [
          `**Verdict: ${state.decision.verdict.toUpperCase()}** ` +
            `(Confidence: ${state.decision.confidence}%)`,
          ``,
          `### Reasoning`,
          state.decision.reasoning,
          ``,
          `### Key Risks`,
          ...state.decision.keyRisks.map((r) => `- ${r}`),
          ``,
          `### Sources`,
          ...state.decision.sources.map((s) => `- ${s}`),
        ].join("\n")
      : "No decision was generated.",
  ].join("\n");

  return {
    analysis: formattedAnalysis,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════

const graphBuilder = new StateGraph(AgentState)
  // Register nodes
  .addNode("research", researchNode)
  .addNode("analyze", analyzeNode)
  .addNode("decide", decideNode)
  .addNode("format", formatNode)

  // Wire edges
  .addEdge(START, "research")
  .addConditionalEdges("research", shouldContinueResearch, {
    research: "research",
    analyze: "analyze",
  })
  .addEdge("analyze", "decide")
  .addEdge("decide", "format")
  .addEdge("format", END);

// ── Compile & export ───────────────────────────────────────────────────────

export const graph = graphBuilder.compile();
