"use client";

import { useState, useRef, useCallback, useEffect } from "react";

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

const STEP_META: Record<string, { label: string }> = {
  start:    { label: "Initialising" },
  research: { label: "Data Collection" },
  analyze:  { label: "Synthesis & Analysis" },
  decide:   { label: "Investment Decision" },
  format:   { label: "Report Generation" },
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  start: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  ),
  research: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  ),
  analyze: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M2 20h20M5 20V10l7-7 7 7v10" />
    </svg>
  ),
  decide: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  ),
  format: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
};

const CHECK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ── Helpers ────────────────────────────────────────────────────────────────

function isValidUrl(str: string): boolean {
  try { new URL(str); return true; } catch { return false; }
}

function formatDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function confidenceClass(v: number): string {
  return v >= 70 ? "high" : v >= 45 ? "medium" : "low";
}

// ── Markdown parser ────────────────────────────────────────────────────────

function parseAnalysisMarkdown(markdown: string): React.ReactNode {
  const lines = markdown.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) { elements.push(<div key={key++} style={{ height: 4 }} />); continue; }

    if (t.startsWith("# ")) {
      elements.push(<h1 key={key++} className="prose-h1">{t.slice(2)}</h1>);
    } else if (t.startsWith("## ")) {
      elements.push(<h2 key={key++} className="prose-h2">{t.slice(3)}</h2>);
    } else if (t.startsWith("### ")) {
      elements.push(<h3 key={key++} className="prose-h3">{t.slice(4)}</h3>);
    } else if (t.startsWith("- ") || t.startsWith("* ")) {
      elements.push(
        <div key={key++} className="prose-li">
          <span className="prose-li-bullet">–</span>
          <span>{renderInline(t.slice(2))}</span>
        </div>
      );
    } else if (t.startsWith("---")) {
      elements.push(<hr key={key++} className="prose-hr" />);
    } else if (t.startsWith("*Research iterations") || t.startsWith("*research iterations")) {
      elements.push(<p key={key++} className="prose-meta">{t.replace(/\*/g, "")}</p>);
    } else if (t.startsWith("**Verdict:")) {
      // Skip — shown in decision card
    } else {
      elements.push(<p key={key++} className="prose-p">{renderInline(t)}</p>);
    }
  }
  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i} className="prose-bold">{p}</strong> : p
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NavBar() {
  return (
    <nav className="nav">
      <a className="nav-logo" href="/">
        <div className="nav-logo-icon">📊</div>
        <span className="nav-logo-text">Research<span>IQ</span></span>
      </a>
      <div className="nav-divider" />
      <div className="nav-links">
        <span className="nav-link active">Research</span>
        <span className="nav-link">Markets</span>
        <span className="nav-link">Portfolio</span>
        <span className="nav-link">Reports</span>
      </div>
      <div className="nav-right">
        <div className="nav-status">
          <span className="status-dot" />
          All systems operational
        </div>
      </div>
    </nav>
  );
}

function StepRow({ step, isLast }: { step: ProgressStep; isLast: boolean }) {
  const meta = STEP_META[step.step] || { label: step.step };
  const icon = STEP_ICONS[step.step];
  const isActive = !step.done;
  const delay = `${Object.keys(STEP_META).indexOf(step.step) * 60}ms`;

  return (
    <div className="step-row" style={{ animationDelay: delay }}>
      <div className="step-line">
        <div className={`step-dot ${step.done ? "done" : "active"}`} style={{ color: step.done ? "#34d399" : "#60a5fa" }}>
          {step.done ? CHECK_ICON : (isActive ? <div className="spinner" /> : icon)}
        </div>
        {!isLast && (
          <div style={{
            position: "absolute", left: "50%", top: 28, bottom: -20,
            transform: "translateX(-50%)", width: 1,
            background: "var(--border-subtle)"
          }} />
        )}
      </div>
      <div className="step-content">
        <div className="step-label">{meta.label}</div>
        <div className="step-message">{step.message}</div>
        {step.data && (
          <div className="step-badges">
            {step.data.iterationCount !== undefined && (
              <span className="badge badge-slate">Iteration {String(step.data.iterationCount)}</span>
            )}
            {step.data.notesGathered !== undefined && (
              <span className="badge badge-blue">{String(step.data.notesGathered)} data points</span>
            )}
            {step.data.hasFinancialData !== undefined && (
              <span className={`badge ${step.data.hasFinancialData ? "badge-green" : "badge-slate"}`}>
                {step.data.hasFinancialData ? "Financial data ✓" : "No financial data"}
              </span>
            )}
            {step.data.verdict !== undefined && (
              <span className={`badge ${step.data.verdict === "invest" ? "badge-green" : "badge-red"}`}>
                {String(step.data.verdict).toUpperCase()} · {String(step.data.confidence)}% confidence
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionCard({ decision, companyName }: { decision: InvestmentDecision; companyName: string }) {
  const isInvest = decision.verdict === "invest";
  const cls = isInvest ? "invest" : "pass";
  const confClass = confidenceClass(decision.confidence);

  return (
    <div className={`decision-card ${cls}`}>
      {/* Header */}
      <div className={`decision-header ${cls}`}>
        <div>
          <div className="decision-company-label">Investment Decision</div>
          <div className="decision-company-name">{companyName}</div>
        </div>
        <div className={`verdict-badge ${cls}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {isInvest
              ? <polyline points="20 6 9 17 4 12" />
              : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
            }
          </svg>
          {isInvest ? "BUY" : "PASS"}
        </div>
      </div>

      {/* Confidence */}
      <div className="confidence-wrap">
        <span className="confidence-label">Confidence</span>
        <div className="confidence-track">
          <div className={`confidence-fill ${confClass}`} style={{ width: `${decision.confidence}%` }} />
        </div>
        <span className="confidence-value">{decision.confidence}%</span>
      </div>

      {/* Reasoning */}
      <div className="card-section">
        <div className="card-section-label">Analyst Reasoning</div>
        <p className="reasoning-text">{decision.reasoning}</p>
      </div>

      {/* Key Risks */}
      {decision.keyRisks.length > 0 && (
        <div className="card-section">
          <div className="card-section-label">Key Risk Factors</div>
          <div className="risk-list">
            {decision.keyRisks.map((r, i) => (
              <div key={i} className="risk-item">
                <span className="risk-bullet" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      {decision.sources.length > 0 && (
        <div className="card-section">
          <div className="card-section-label">Data Sources</div>
          <div className="source-chips">
            {decision.sources.map((src, i) =>
              isValidUrl(src) ? (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="source-chip">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  {formatDomain(src)}
                </a>
              ) : (
                <span key={i} className="source-chip-plain">{src}</span>
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

  const cleaned = analysis
    .replace(/^# Investment Research Report:.*\n?/m, "")
    .replace(/\*Research iterations:.*\n?/g, "")
    .replace(/---\n?## Investment Decision[\s\S]*/m, "")
    .trim();

  const LIMIT = 1400;
  const isLong = cleaned.length > LIMIT;
  let preview = cleaned;
  if (isLong && !expanded) {
    const candidate = cleaned.slice(0, LIMIT);
    const idx = Math.max(candidate.lastIndexOf("."), candidate.lastIndexOf("!"), candidate.lastIndexOf("?"));
    preview = idx > LIMIT * 0.5 ? cleaned.slice(0, idx + 1) + "…" : candidate + "…";
  }

  return (
    <div className="analysis-card">
      <div className="analysis-header">
        <div className="analysis-header-left">
          <div className="analysis-dot" />
          <span className="analysis-title">Research Analysis</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {Math.ceil(cleaned.length / 5)} words
        </span>
      </div>
      <div className="analysis-body">
        {parseAnalysisMarkdown(expanded ? cleaned : preview)}
        {isLong && (
          <button className="read-more-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less ↑" : "Read full analysis ↓"}
          </button>
        )}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-base)", borderRadius: 12, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div className="skeleton" style={{ height: 10, width: 120, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 22, width: 200 }} />
          </div>
          <div className="skeleton" style={{ height: 34, width: 90, borderRadius: 8 }} />
        </div>
        <div className="skeleton" style={{ height: 4, width: "100%", marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 10, width: 80, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 14, width: "100%", marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 14, width: "85%", marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 14, width: "70%" }} />
      </div>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-base)", borderRadius: 12, padding: 24 }}>
        <div className="skeleton" style={{ height: 10, width: 140, marginBottom: 16 }} />
        {[100, 92, 78, 88, 65].map((w, i) => (
          <div key={i} className="skeleton" style={{ height: 13, width: `${w}%`, marginBottom: 8 }} />
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const EXAMPLE_COMPANIES = ["Apple", "Stripe", "Nvidia", "Tesla", "OpenAI"];

export default function Home() {
  const [companyName, setCompanyName] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const stepCounterRef = useRef(0);

  useEffect(() => { return () => { abortRef.current?.abort(); }; }, []);

  const addStep = useCallback((step: string, message: string, data?: Record<string, unknown>) => {
    const id = `step-${stepCounterRef.current++}-${step}`;
    setSteps(prev => {
      const updated = prev.map(s => (!s.done ? { ...s, done: true } : s));
      return [...updated, { id, step, message, data, timestamp: Date.now(), done: false }];
    });
  }, []);

  const markLastDone = useCallback(() => {
    setSteps(prev => prev.map((s, i) => i === prev.length - 1 ? { ...s, done: true } : s));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = companyName.trim();
    if (!name || appState === "loading") return;

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

      if (!response.ok || !response.body) throw new Error(`Server error: ${response.status}`);

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
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.type === "progress") addStep(json.step, json.message, json.data);
            else if (json.type === "complete") { markLastDone(); setResult(json.result); setAppState("complete"); }
            else if (json.type === "error") { setErrorMsg(json.message); setAppState("error"); }
          } catch { /* skip malformed */ }
        }
      }

      setAppState(prev => {
        if (prev === "loading") { markLastDone(); setErrorMsg("Research stream ended unexpectedly. Please try again."); return "error"; }
        return prev;
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
      setAppState("error");
    }
  }, [companyName, appState, addStep, markLastDone]);

  const handleReset = () => {
    abortRef.current?.abort();
    setAppState("idle");
    setSteps([]);
    setResult(null);
    setErrorMsg("");
    setCompanyName("");
  };

  const isLoading  = appState === "loading";
  const isComplete = appState === "complete";
  const isError    = appState === "error";

  return (
    <>
      {/* Background grid */}
      <div className="grid-bg" />

      {/* Navigation */}
      <NavBar />

      {/* Main layout */}
      <div style={{ position: "relative", zIndex: 1 }}>

        {/* ── Hero ── */}
        <div className="hero">
          <div className="hero-eyebrow">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Institutional-Grade Research
          </div>

          <h1 className="hero-title">
            Company Due Diligence,<br />
            <span className="hero-title-accent">Powered by AI</span>
          </h1>

          <p className="hero-sub">
            Enter any company name to receive a structured investment analysis —
            business overview, financial metrics, competitive positioning, risk signals, and a final verdict.
          </p>

          {/* Search */}
          <form onSubmit={handleSubmit} style={{ width: "100%" }}>
            <div className="search-box">
              <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                id="company-name-input"
                className="search-input"
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. Apple, Stripe, SpaceX, Nvidia…"
                disabled={isLoading}
                autoFocus
                maxLength={200}
                aria-label="Company name"
              />
              <button
                type="submit"
                id="research-submit-btn"
                className="search-btn"
                disabled={isLoading || !companyName.trim()}
              >
                {isLoading ? (
                  <>
                    <div className="spinner" style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "#fff" }} />
                    Analysing…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Run Analysis
                  </>
                )}
              </button>
            </div>

            {/* Quick-pick chips */}
            {appState === "idle" && (
              <div className="chips">
                <span className="chip-label">Try:</span>
                {EXAMPLE_COMPANIES.map(co => (
                  <button key={co} type="button" className="chip" onClick={() => setCompanyName(co)}>
                    {co}
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Trust bar */}
          {appState === "idle" && (
            <div className="trust-bar">
              {[
                { icon: "🔗", label: "7 Data Sources" },
                { icon: "⚡", label: "Real-time Analysis" },
                { icon: "🛡", label: "LangGraph Verified" },
                { icon: "📊", label: "Alpha Vantage + Tavily" },
              ].map((item, i, arr) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <span className="trust-item">
                    <span>{item.icon}</span>
                    {item.label}
                  </span>
                  {i < arr.length - 1 && <span className="trust-sep" />}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Content area ── */}
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 80px" }}>

          {/* Feature cards (idle only) */}
          {appState === "idle" && (
            <div className="features">
              {[
                {
                  cls: "blue", emoji: "🔍",
                  title: "Web Intelligence",
                  desc: "Business model, recent news, and competitive landscape via real-time web search.",
                },
                {
                  cls: "gold", emoji: "📈",
                  title: "Financial Metrics",
                  desc: "P/E ratio, market cap, revenue, profit margins, and live stock quotes.",
                },
                {
                  cls: "red", emoji: "⚠️",
                  title: "Risk Signals",
                  desc: "Lawsuits, layoffs, regulatory actions, and executive leadership changes.",
                },
              ].map((f, i) => (
                <div key={i} className="feature-card">
                  <div className={`feature-icon ${f.cls}`}>{f.emoji}</div>
                  <div className="feature-title">{f.title}</div>
                  <div className="feature-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          )}

          {/* Progress panel */}
          {(isLoading || isComplete || isError) && steps.length > 0 && (
            <div className="progress-panel" style={{ marginBottom: 20 }}>
              <div className="progress-header">
                <div className="progress-header-left">
                  {isLoading && <div className="spinner" />}
                  {isComplete && (
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(16,185,129,0.12)", border: "1.5px solid rgba(16,185,129,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#34d399" }}>
                      {CHECK_ICON}
                    </div>
                  )}
                  {isError && <span style={{ color: "#f87171", fontSize: 14 }}>⚠</span>}
                  <span className="progress-title">
                    {isLoading ? "Research in progress" : isComplete ? "Research complete" : "Research failed"}
                  </span>
                </div>
                {(isComplete || isError) && (
                  <button className="reset-btn" onClick={handleReset}>
                    ↺ New research
                  </button>
                )}
              </div>
              <div className="progress-body">
                {steps.map((step, i) => (
                  <StepRow key={step.id} step={step} isLast={i === steps.length - 1} />
                ))}
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && <SkeletonCard />}

          {/* Error */}
          {isError && (
            <div className="alert alert-error" style={{ marginBottom: 20 }}>
              <span className="alert-icon">⚠️</span>
              <div>
                <div className="alert-title">Analysis failed</div>
                <div className="alert-body">{errorMsg}</div>
                <button className="alert-btn" onClick={handleReset}>Try again</button>
              </div>
            </div>
          )}

          {/* Results */}
          {isComplete && result && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {result.decision ? (
                <DecisionCard decision={result.decision} companyName={result.companyName} />
              ) : (
                <div className="alert alert-warning">
                  <span className="alert-icon">⚠️</span>
                  <div>
                    <div className="alert-title">No decision generated</div>
                    <div className="alert-body">
                      The agent was unable to produce a structured decision for <strong>{result.companyName}</strong>.
                      This typically happens when API rate limits are hit or insufficient data was gathered.
                    </div>
                  </div>
                </div>
              )}

              {result.analysis && <AnalysisCard analysis={result.analysis} />}

              {/* Metadata row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
                {[
                  `${result.iterationCount} research iteration${result.iterationCount !== 1 ? "s" : ""}`,
                  `${result.researchNotes.length} data points collected`,
                  `${result.newsFindings.length} news signals`,
                  result.financialData?.isPubliclyTraded ? "Publicly traded ✓" : "Private company",
                ].map((item, i) => (
                  <span key={i} className="badge badge-slate">{item}</span>
                ))}
              </div>

              <button className="reset-btn" onClick={handleReset} style={{ alignSelf: "flex-start" }}>
                ↺ Research another company
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="footer">
          <span className="footer-text">
            ResearchIQ — Built with LangGraph, Groq (LLaMA 3.3 70B), Tavily, Alpha Vantage & Next.js 14
          </span>
          <span className="footer-text">
            For informational purposes only — not financial advice. Always conduct independent due diligence.
          </span>
        </footer>
      </div>
    </>
  );
}
