import { NextRequest } from "next/server";
import { graph } from "@/lib/agent/graph";
import type { InvestmentDecision } from "@/lib/agent/state";

// ---------------------------------------------------------------------------
// POST /api/research
// ---------------------------------------------------------------------------
// Accepts: { companyName: string }
// Returns: Server-Sent Events stream with per-node progress + final decision
//
// SSE event shapes:
//   { type: "progress", step: string, message: string, data?: unknown }
//   { type: "complete", result: ResearchResult }
//   { type: "error",    message: string }
// ---------------------------------------------------------------------------

// Force this route into Node.js runtime (not Edge) — LangGraph needs Node APIs
export const runtime = "nodejs";

// Disable response caching
export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────

interface ResearchResult {
  companyName: string;
  analysis: string | null;
  decision: InvestmentDecision | null;
  researchNotes: string[];
  newsFindings: string[];
  iterationCount: number;
  financialData: Record<string, unknown> | null;
}

type SSEEvent =
  | { type: "progress"; step: string; message: string; data?: unknown }
  | { type: "complete"; result: ResearchResult }
  | { type: "error"; message: string };

// ── SSE helpers ────────────────────────────────────────────────────────────

/** Serialises an SSE event to the `data: ...\n\n` wire format */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Human-readable messages and contextual data for each graph node */
function nodeMetadata(
  nodeName: string,
  update: Record<string, unknown>
): { message: string; data?: unknown } {
  switch (nodeName) {
    case "research": {
      const iter = (update.iterationCount as number) ?? 1;
      const noteCount = Array.isArray(update.researchNotes)
        ? (update.researchNotes as unknown[]).length
        : 0;
      return {
        message: `Research iteration ${iter} complete — ${noteCount} data point(s) collected.`,
        data: {
          iterationCount: iter,
          notesGathered: noteCount,
          hasFinancialData: update.financialData !== null,
        },
      };
    }
    case "analyze":
      return {
        message: "Analysis complete — synthesising business model, financials, market position and risks.",
        data: { analysisLength: (update.analysis as string | null)?.length ?? 0 },
      };
    case "decide": {
      const decision = update.decision as InvestmentDecision | null;
      return {
        message: decision
          ? `Investment decision: ${decision.verdict.toUpperCase()} (confidence ${decision.confidence}%)`
          : "Decision generated.",
        data: decision
          ? { verdict: decision.verdict, confidence: decision.confidence }
          : undefined,
      };
    }
    case "format":
      return { message: "Report formatted and ready." };
    default:
      return { message: `Node "${nodeName}" completed.` };
  }
}

// ── Request validation ─────────────────────────────────────────────────────

function validateBody(
  body: unknown
): { companyName: string } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const { companyName } = body as Record<string, unknown>;
  if (!companyName || typeof companyName !== "string") {
    return { error: "Missing required field: companyName (string)." };
  }
  const trimmed = companyName.trim();
  if (trimmed.length < 1) {
    return { error: "companyName must not be empty." };
  }
  if (trimmed.length > 200) {
    return { error: "companyName must be 200 characters or fewer." };
  }
  return { companyName: trimmed };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // ── 1. Parse & validate ──────────────────────────────────────────────

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      formatSSE({ type: "error", message: "Invalid JSON in request body." }),
      {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }

  const validation = validateBody(body);
  if ("error" in validation) {
    return new Response(
      formatSSE({ type: "error", message: validation.error }),
      {
        status: 422,
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }

  const { companyName } = validation;

  // ── 2. Set up SSE response stream ─────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(formatSSE(event)));
      };

      try {
        // Emit initial event so the client knows we're starting
        enqueue({
          type: "progress",
          step: "start",
          message: `Starting investment research for "${companyName}"…`,
        });

        // ── 3. Run the LangGraph in streaming mode ──────────────────────

        const graphStream = await graph.stream(
          { companyName },
          { streamMode: "updates" }
        );

        // Track final state across updates
        let finalCompanyName = companyName;
        let finalAnalysis: string | null = null;
        let finalDecision: InvestmentDecision | null = null;
        let finalResearchNotes: string[] = [];
        let finalNewsFindings: string[] = [];
        let finalIterationCount = 0;
        let finalFinancialData: Record<string, unknown> | null = null;

        // ── 4. Process each chunk from the graph ────────────────────────
        // With streamMode "updates", each chunk is:
        //   Record<nodeName, partialStateUpdate>

        for await (const chunk of graphStream) {
          // chunk is { [nodeName]: { ...stateUpdates } }
          for (const [nodeName, update] of Object.entries(
            chunk as Record<string, Record<string, unknown>>
          )) {
            // Merge updates into our tracking state
            if (update.analysis !== undefined) {
              finalAnalysis = update.analysis as string | null;
            }
            if (update.decision !== undefined) {
              finalDecision = update.decision as InvestmentDecision | null;
            }
            if (Array.isArray(update.researchNotes)) {
              finalResearchNotes = [
                ...finalResearchNotes,
                ...(update.researchNotes as string[]),
              ];
            }
            if (Array.isArray(update.newsFindings)) {
              finalNewsFindings = [
                ...finalNewsFindings,
                ...(update.newsFindings as string[]),
              ];
            }
            if (typeof update.iterationCount === "number") {
              finalIterationCount = update.iterationCount;
            }
            if (update.financialData !== undefined) {
              finalFinancialData = update.financialData as Record<
                string,
                unknown
              > | null;
            }
            if (update.companyName) {
              finalCompanyName = update.companyName as string;
            }

            // Emit a progress event for this node
            const { message, data } = nodeMetadata(nodeName, update);
            enqueue({
              type: "progress",
              step: nodeName,
              message,
              data,
            });
          }
        }

        // ── 5. Emit the final complete event ────────────────────────────

        const result: ResearchResult = {
          companyName: finalCompanyName,
          analysis: finalAnalysis,
          decision: finalDecision,
          researchNotes: finalResearchNotes,
          newsFindings: finalNewsFindings,
          iterationCount: finalIterationCount,
          financialData: finalFinancialData,
        };

        enqueue({ type: "complete", result });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unknown error occurred.";
        console.error("[/api/research] Graph execution error:", err);

        enqueue({
          type: "error",
          message: `Research failed: ${message}`,
        });
      } finally {
        controller.close();
      }
    },
  });

  // ── 6. Return the SSE response ─────────────────────────────────────────

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering for SSE
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ── OPTIONS handler (CORS preflight) ──────────────────────────────────────

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
