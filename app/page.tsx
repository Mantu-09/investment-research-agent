"use client";

import { useState, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface InvestmentDecision {
  verdict: "invest" | "pass";
  confidence: number;
  reasoning: string;
  keyRisks: string[];
  sources: string[];
}

interface ResearchResult {
  companyName: string;
  analysis: string | null;
  decision: InvestmentDecision | null;
  researchNotes: string[];
  newsFindings: string[];
  iterationCount: number;
  financialData: Record<string, unknown> | null;
}

interface ProgressStep {
  id: string;
  step: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
  done: boolean;
}

type AppState = "idle" | "loading" | "complete" | "error";

// ── Step metadata ──────────────────────────────────────────────────────────

const STEP_META: Record<string, { label: string; icon: string }> = {
  start:    { label: "Initialising",          icon: "⚡" },
  research: { label: "Researching Company",   icon: "🔍" },
  analyze:  { label: "Synthesising Analysis", icon: "🧠" },
  decide:   { label: "Forming Decision",      icon: "⚖️"  },
  format:   { label: "Preparing Report",      icon: "📄" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAnalysisMarkdown(markdown: string): React.ReactNode {
  const lines = markdown.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={key++} className="text-xl font-bold text-white mb-4">
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={key++} className="text-sm font-bold text-slate-100 mt-6 mb-2 pb-1.5 border-b border-slate-700/60 uppercase tracking-wider">
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={key++} className="text-sm font-semibold text-slate-200 mt-3 mb-1">
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      elements.push(
        <li key={key++} className="flex gap-2 items-start text-slate-400 text-sm leading-relaxed mb-1">
          <span className="text-slate-600 mt-0.5 shrink-0">–</span>
          <span>{trimmed.slice(2)}</span>
        </li>
      );
    } else if (trimmed.startsWith("*Research iterations")) {
      elements.push(
        <p key={key++} className="text-xs text-slate-500 italic mb-3">{trimmed.replace(/\*/g, "")}</p>
      );
    } else if (trimmed.startsWith("---")) {
      elements.push(<hr key={key++} className="border-slate-700/50 my-4" />);
    } else if (trimmed.startsWith("**Verdict:")) {
      // Skip — we show the verdict in the decision card
    } else {
      elements.push(
        <p key={key++} className="text-slate-400 text-sm leading-relaxed mb-2">
          {trimmed.replace(/\*\*(.*?)\*\*/g, (_, t) => t)}
        </p>
      );
    }
  }

  return <>{elements}</>;
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function formatDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-emerald-500" :
    value >= 45 ? "bg-amber-400"  :
                  "bg-rose-500";

  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Confidence</span>
        <span className="text-sm font-bold text-slate-200">{value}%</span>
      </div>
      <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function StepItem({ step, index }: { step: ProgressStep; index: number }) {
  const meta = STEP_META[step.step] || { label: step.step, icon: "●" };
  const isActive = !step.done;

  return (
    <div
      className="flex items-start gap-3 animate-slide-in"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Icon / spinner */}
      <div className="mt-0.5 shrink-0">
        {isActive ? (
          <div className="w-5 h-5 rounded-full border-2 border-emerald-500/40 border-t-emerald-400 animate-spin-slow" />
        ) : (
          <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {meta.icon} {meta.label}
          </span>
          {isActive && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
              Live
            </span>
          )}
        </div>
        <p className="text-sm text-slate-300 leading-snug">{step.message}</p>

        {/* Extra data badges */}
        {step.data && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {step.data.iterationCount !== undefined && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700/50 text-slate-400 border border-slate-600/40">
                Iteration {String(step.data.iterationCount)}
              </span>
            )}
            {step.data.notesGathered !== undefined && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-blue-900/30 text-blue-400 border border-blue-800/30">
                {String(step.data.notesGathered)} data points
              </span>
            )}
            {step.data.verdict !== undefined && (
              <span className={`px-2 py-0.5 rounded-full text-xs border font-semibold ${
                step.data.verdict === "invest"
                  ? "bg-emerald-900/30 text-emerald-400 border-emerald-700/30"
                  : "bg-rose-900/30 text-rose-400 border-rose-700/30"
              }`}>
                {String(step.data.verdict).toUpperCase()} · {String(step.data.confidence)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: "invest" | "pass" }) {
  const isInvest = verdict === "invest";
  return (
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold uppercase tracking-widest border ${
      isInvest
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 glow-emerald"
        : "bg-rose-500/15 text-rose-300 border-rose-500/30 glow-rose"
    }`}>
      <span className={`w-2 h-2 rounded-full ${isInvest ? "bg-emerald-400" : "bg-rose-400"} animate-pulse-dot`} />
      {isInvest ? "✓ Invest" : "✕ Pass"}
    </div>
  );
}

function DecisionCard({ decision, companyName }: { decision: InvestmentDecision; companyName: string }) {
  const isInvest = decision.verdict === "invest";

  return (
    <div className="animate-fade-up rounded-2xl border bg-slate-800/40 backdrop-blur-sm overflow-hidden"
      style={{
        borderColor: isInvest ? "rgba(16,185,129,0.25)" : "rgba(244,63,94,0.25)",
        boxShadow: isInvest
          ? "0 0 40px rgba(16,185,129,0.08), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 0 40px rgba(244,63,94,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Card header */}
      <div className={`px-6 py-5 border-b ${isInvest ? "border-emerald-800/30" : "border-rose-800/30"}`}
        style={{
          background: isInvest
            ? "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(17,24,39,0) 60%)"
            : "linear-gradient(135deg, rgba(244,63,94,0.08) 0%, rgba(17,24,39,0) 60%)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest mb-1">Investment Decision</p>
            <h2 className="text-xl font-bold text-white">{companyName}</h2>
          </div>
          <VerdictBadge verdict={decision.verdict} />
        </div>
        <ConfidenceBar value={decision.confidence} />
      </div>

      {/* Reasoning */}
      <div className="px-6 py-5 border-b border-slate-700/40">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Reasoning</p>
        <p className="text-sm text-slate-300 leading-relaxed">{decision.reasoning}</p>
      </div>

      {/* Key risks */}
      {decision.keyRisks.length > 0 && (
        <div className="px-6 py-5 border-b border-slate-700/40">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Key Risks</p>
          <ul className="space-y-2">
            {decision.keyRisks.map((risk, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-sm text-slate-400 leading-relaxed">{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sources */}
      {decision.sources.length > 0 && (
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Sources</p>
          <div className="flex flex-wrap gap-2">
            {decision.sources.map((src, i) =>
              isValidUrl(src) ? (
                <a
                  key={i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-700/40 text-blue-400 border border-slate-600/30 hover:bg-slate-700/70 hover:text-blue-300 transition-colors"
                >
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  {formatDomain(src)}
                </a>
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs bg-slate-700/30 text-slate-400 border border-slate-600/20"
                >
                  {src}
                </span>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: string }) {
  const [expanded, setExpanded] = useState(false);

  // Strip the report header lines (already shown in the card header) and decision section (shown separately)
  const cleanedAnalysis = analysis
    .replace(/^# Investment Research Report:.*\n?/m, "")
    .replace(/\*Research iterations:.*\n?/g, "")
    .replace(/---\n?## Investment Decision[\s\S]*/m, "")
    .trim();

  const isLong = cleanedAnalysis.length > 1200;
  const displayText = isLong && !expanded ? cleanedAnalysis.slice(0, 1200) + "…" : cleanedAnalysis;

  return (
    <div className="animate-fade-up rounded-2xl border border-slate-700/40 bg-slate-800/30 backdrop-blur-sm overflow-hidden"
      style={{ animationDelay: "120ms" }}
    >
      <div className="px-6 py-4 border-b border-slate-700/40 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blue-400" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Research Analysis</p>
      </div>
      <div className="px-6 py-5">
        <div className="prose-analysis">
          {parseAnalysisMarkdown(displayText)}
        </div>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
          >
            {expanded ? "Show less ↑" : "Show full analysis ↓"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [companyName, setCompanyName] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const stepCounterRef = useRef(0);

  const addStep = useCallback((step: string, message: string, data?: Record<string, unknown>) => {
    const id = `step-${stepCounterRef.current++}-${step}`;
    setSteps((prev) => {
      // Mark all previous active steps as done
      const updated = prev.map((s) => (!s.done ? { ...s, done: true } : s));
      return [
        ...updated,
        { id, step, message, data, timestamp: Date.now(), done: false },
      ];
    });
  }, []);

  const markLastDone = useCallback(() => {
    setSteps((prev) => prev.map((s, i) => i === prev.length - 1 ? { ...s, done: true } : s));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = companyName.trim();
      if (!name || appState === "loading") return;

      // Reset state
      setAppState("loading");
      setSteps([]);
      setResult(null);
      setErrorMsg("");
      stepCounterRef.current = 0;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyName: name }),
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const dataLine = part.trim();
            if (!dataLine.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(dataLine.slice(6));

              if (json.type === "progress") {
                addStep(json.step, json.message, json.data);
              } else if (json.type === "complete") {
                markLastDone();
                setResult(json.result);
                setAppState("complete");
              } else if (json.type === "error") {
                setErrorMsg(json.message);
                setAppState("error");
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setErrorMsg(
          err instanceof Error ? err.message : "An unexpected error occurred."
        );
        setAppState("error");
      }
    },
    [companyName, appState, addStep, markLastDone]
  );

  const handleReset = () => {
    abortRef.current?.abort();
    setAppState("idle");
    setSteps([]);
    setResult(null);
    setErrorMsg("");
    setCompanyName("");
  };

  const isLoading = appState === "loading";
  const isComplete = appState === "complete";
  const isError = appState === "error";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      {/* ── Background gradient blobs ── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #10b981, transparent 70%)" }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #3b82f6, transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #8b5cf6, transparent 70%)" }} />
      </div>

      {/* ── Header ── */}
      <header className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
            style={{ background: "linear-gradient(135deg, #10b981, #3b82f6)" }}>
            📈
          </div>
          <div>
            <span className="text-base font-bold text-white tracking-tight">ResearchAgent</span>
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/40 font-medium">AI</span>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
          Powered by LangGraph + Groq
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="relative z-10 flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">

        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4 text-balance">
            <span className="text-white">AI-Powered </span>
            <span className="gradient-text">Investment Research</span>
          </h1>
          <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
            Enter any company name and get a structured due-diligence report —
            business overview, financial health, competitive position, risk factors, and a final verdict.
          </p>
        </div>

        {/* ── Search form ── */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="relative group">
            {/* Glow ring on focus */}
            <div className="absolute -inset-0.5 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"
              style={{ background: "linear-gradient(135deg, #10b981, #3b82f6)", filter: "blur(6px)" }} />

            <div className="relative flex flex-col sm:flex-row gap-3 bg-slate-800/70 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-3">
              {/* Search icon */}
              <div className="hidden sm:flex items-center pl-2 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              <input
                id="company-name-input"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Apple, Stripe, SpaceX, Nvidia…"
                disabled={isLoading}
                autoFocus
                maxLength={200}
                className="flex-1 bg-transparent text-white placeholder-slate-500 text-base font-medium outline-none px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Company name"
              />

              <button
                type="submit"
                id="research-submit-btn"
                disabled={isLoading || !companyName.trim()}
                className="relative flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #059669, #2563eb)",
                }}
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin-slow" />
                    Researching…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Analyse
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Example chips */}
          {appState === "idle" && (
            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {["Apple", "Stripe", "Nvidia", "OpenAI", "Tesla"].map((co) => (
                <button
                  key={co}
                  type="button"
                  onClick={() => setCompanyName(co)}
                  className="px-3 py-1 rounded-full text-xs text-slate-400 border border-slate-700/60 hover:border-slate-500 hover:text-slate-200 transition-colors bg-slate-800/30"
                >
                  {co}
                </button>
              ))}
            </div>
          )}
        </form>

        {/* ── Progress steps ── */}
        {(isLoading || isComplete || isError) && steps.length > 0 && (
          <div className="mb-8 rounded-2xl border border-slate-700/40 bg-slate-800/30 backdrop-blur-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-700/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isLoading && (
                  <div className="w-4 h-4 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin-slow" />
                )}
                {isComplete && (
                  <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                {isError && <span className="text-rose-400 text-xs">⚠</span>}
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  {isLoading ? "Research in progress" : isComplete ? "Research complete" : "Error"}
                </span>
              </div>
              {(isComplete || isError) && (
                <button
                  onClick={handleReset}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                >
                  ↺ New search
                </button>
              )}
            </div>

            {/* Steps list */}
            <div className="p-5 space-y-4">
              {steps.map((step, i) => (
                <StepItem key={step.id} step={step} index={i} />
              ))}
            </div>
          </div>
        )}

        {/* ── Error state ── */}
        {isError && (
          <div className="animate-fade-up rounded-2xl border border-rose-800/40 bg-rose-900/10 px-6 py-5 mb-8">
            <div className="flex items-start gap-3">
              <span className="text-rose-400 text-lg mt-0.5">⚠</span>
              <div>
                <p className="text-sm font-semibold text-rose-300 mb-1">Research failed</p>
                <p className="text-sm text-rose-400/80 leading-relaxed">{errorMsg}</p>
                <button
                  onClick={handleReset}
                  className="mt-3 text-xs text-rose-400 hover:text-rose-300 font-medium border border-rose-800/40 hover:border-rose-700/40 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {isComplete && result && (
          <div className="space-y-6">
            {/* Decision card */}
            {result.decision && (
              <DecisionCard
                decision={result.decision}
                companyName={result.companyName}
              />
            )}

            {/* Analysis card */}
            {result.analysis && (
              <AnalysisCard analysis={result.analysis} />
            )}

            {/* Stats row */}
            <div className="animate-fade-up grid grid-cols-3 gap-3" style={{ animationDelay: "240ms" }}>
              {[
                { label: "Research Iterations", value: String(result.iterationCount), icon: "🔄" },
                { label: "Data Points", value: String(result.researchNotes.length), icon: "📊" },
                { label: "News Signals", value: String(result.newsFindings.length), icon: "📰" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-slate-700/40 bg-slate-800/30 px-4 py-4 text-center"
                >
                  <div className="text-xl mb-1">{stat.icon}</div>
                  <div className="text-lg font-bold text-white">{stat.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5 leading-tight">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* New search CTA */}
            <div className="animate-fade-up text-center pt-2" style={{ animationDelay: "300ms" }}>
              <button
                onClick={handleReset}
                id="new-search-btn"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border border-slate-600/40 text-slate-300 hover:border-slate-500 hover:text-white hover:bg-slate-700/30 transition-all"
              >
                ↺ Research another company
              </button>
            </div>
          </div>
        )}

        {/* ── Idle empty state ── */}
        {appState === "idle" && (
          <div className="mt-4 text-center">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {[
                { icon: "🔍", title: "Web Research", desc: "Company overview, news, and competitive landscape" },
                { icon: "📈", title: "Financial Data", desc: "P/E ratio, market cap, revenue and profit margins" },
                { icon: "⚠️", title: "Risk Analysis", desc: "Lawsuits, layoffs, regulatory and leadership signals" },
              ].map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-slate-800/60 bg-slate-800/20 px-4 py-5 text-left hover:border-slate-700/60 hover:bg-slate-800/40 transition-all duration-200"
                >
                  <div className="text-2xl mb-3">{f.icon}</div>
                  <p className="text-sm font-semibold text-slate-200 mb-1">{f.title}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-slate-800/60 py-6 px-4 sm:px-6 text-center">
        <p className="text-xs text-slate-600">
          Investment Research Agent · Built with{" "}
          <span className="text-slate-500">LangGraph</span>,{" "}
          <span className="text-slate-500">Groq</span>,{" "}
          <span className="text-slate-500">Next.js 14</span>
        </p>
        <p className="text-xs text-slate-700 mt-1">
          For informational purposes only — not financial advice.
        </p>
      </footer>
    </div>
  );
}
