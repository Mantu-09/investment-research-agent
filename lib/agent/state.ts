import { Annotation } from "@langchain/langgraph";

// ---------------------------------------------------------------------------
// Investment Research Agent — State Schema
// ---------------------------------------------------------------------------
// Defines the shape of state that flows through every node of the LangGraph.
// Fields using a `reducer` accumulate values across iterations (append-only).
// Fields without a reducer are overwritten on each update (last-write-wins).
// ---------------------------------------------------------------------------

/**
 * The final investment decision object produced by the "decide" node.
 */
export interface InvestmentDecision {
  /** Overall recommendation */
  verdict: "invest" | "pass";
  /** Confidence score 0-100 */
  confidence: number;
  /** Detailed reasoning behind the verdict */
  reasoning: string;
  /** Key risk factors identified */
  keyRisks: string[];
  /** Sources consulted during the research */
  sources: string[];
}

/**
 * Root state annotation for the investment research agent graph.
 *
 * Nodes read from `typeof AgentState.State` and return partial updates
 * matching `typeof AgentState.Update`.
 */
export const AgentState = Annotation.Root({
  // ── Inputs ────────────────────────────────────────────────────────────
  /** The company or ticker the user wants to research */
  companyName: Annotation<string>,

  // ── Research accumulation (append-only reducers) ──────────────────────
  /** Notes collected by the research node across iterations */
  researchNotes: Annotation<string[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),

  /** Financial data fetched from APIs (last-write-wins, nullable) */
  financialData: Annotation<Record<string, unknown> | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** News and sentiment findings (append-only) */
  newsFindings: Annotation<string[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),

  // ── Control flow ──────────────────────────────────────────────────────
  /** Whether enough data has been gathered to move to analysis */
  sufficientData: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** Tracks how many research iterations have been executed */
  iterationCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // ── Outputs ───────────────────────────────────────────────────────────
  /** Free-form analysis text produced by the "analyze" node */
  analysis: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** Structured investment decision produced by the "decide" node */
  decision: Annotation<InvestmentDecision | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

/** Convenience type alias for the full state value */
export type AgentStateType = typeof AgentState.State;

/** Convenience type alias for partial state updates returned by nodes */
export type AgentStateUpdate = typeof AgentState.Update;
