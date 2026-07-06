import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";

// ---------------------------------------------------------------------------
// Investment Research Agent — Graph Definition
// ---------------------------------------------------------------------------
// Wiring:
//   START → research → (conditional) → analyze → decide → format → END
//
// The conditional edge after "research" checks:
//   • If `sufficientData` is false AND `iterationCount < 3`  → loop to "research"
//   • Otherwise                                               → proceed to "analyze"
// ---------------------------------------------------------------------------

// ── Stub node functions (to be implemented in Phase 2) ─────────────────────

/**
 * Research node — gathers financial data, news, and company information.
 * Increments iterationCount on each pass.
 */
const researchNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  // Stub: return state unchanged (increment iteration to avoid infinite loop)
  return {
    iterationCount: state.iterationCount + 1,
  };
};

/**
 * Analyze node — synthesises research notes and financial data into
 * a coherent analysis narrative.
 */
const analyzeNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  // Stub: pass through
  return {};
};

/**
 * Decide node — produces a structured InvestmentDecision object
 * (verdict, confidence, reasoning, risks, sources).
 */
const decideNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  // Stub: pass through
  return {};
};

/**
 * Format node — prepares the final human-readable output for the UI.
 */
const formatNode = async (
  state: AgentStateType
): Promise<Partial<AgentStateType>> => {
  // Stub: pass through
  return {};
};

// ── Conditional routing function ───────────────────────────────────────────

/**
 * Determines whether the research loop should continue or move to analysis.
 *
 * Returns the name of the next node:
 *   "research" — if more data is needed and we haven't exceeded max iterations
 *   "analyze"  — otherwise
 */
const shouldContinueResearch = (state: AgentStateType): string => {
  if (!state.sufficientData && state.iterationCount < 3) {
    return "research";
  }
  return "analyze";
};

// ── Graph construction ─────────────────────────────────────────────────────

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
