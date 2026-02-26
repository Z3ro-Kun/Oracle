"use client";

import { useState, useRef, useEffect } from "react";
import {
  Cpu, FileText, Target, Zap, ChevronRight,
  Copy, Check, AlertCircle, Upload, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = "idle" | "running" | "token" | "done" | "error";

interface AgentResult {
  status: AgentStatus;
  output: string;   // accumulates tokens; final text on done
  wordCount: number;
}

interface PipelineResults {
  profile_summary: AgentResult;
  deep_research:   AgentResult;
  fitness_eval:    AgentResult;
  strategy:        AgentResult;
}

interface StreamChunk {
  agent:  keyof PipelineResults;
  status: AgentStatus;
  output?: string;
  token?:  string;
  error?:  string;
}

const AGENTS: {
  key: keyof PipelineResults;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  { key: "profile_summary", label: "Profile Summarizer", subtitle: "Extracting professional background", icon: <FileText size={16} />, color: "#60A5FA" },
  { key: "deep_research",   label: "Deep Research",      subtitle: "Investigating company & culture",  icon: <Cpu size={16} />,      color: "#A78BFA" },
  { key: "fitness_eval",    label: "Fitness Evaluation", subtitle: "Matching resume to opportunity",   icon: <Target size={16} />,   color: "#34D399" },
  { key: "strategy",        label: "Strategic Planner",  subtitle: "Crafting personalized outreach",  icon: <Zap size={16} />,      color: "#F59E0B" },
];

const DEFAULT_RESULT: AgentResult = { status: "idle", output: "", wordCount: 0 };
const DEFAULT_RESULTS: PipelineResults = {
  profile_summary: { ...DEFAULT_RESULT },
  deep_research:   { ...DEFAULT_RESULT },
  fitness_eval:    { ...DEFAULT_RESULT },
  strategy:        { ...DEFAULT_RESULT },
};

// ─── Markdown renderer ────────────────────────────────────────────────────────

function parseLine(line: string, key: number): React.ReactNode {
  // Convert **bold** inline
  const parts = line.split(/\*\*(.*?)\*\*/g);
  const nodes = parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="text-[#E8EAF0] font-semibold">{part}</strong>
      : part
  );

  if (/^#{1,3}\s/.test(line)) {
    const text = line.replace(/^#{1,3}\s/, "");
    const textParts = text.split(/\*\*(.*?)\*\*/g).map((p, i) =>
      i % 2 === 1 ? <strong key={i}>{p}</strong> : p
    );
    return (
      <p key={key} className="text-[#F59E0B] font-mono text-[11px] uppercase tracking-widest mt-3 mb-1">
        {textParts}
      </p>
    );
  }
  if (/^[-*]\s/.test(line)) {
    return (
      <div key={key} className="flex gap-2 items-start pl-1 my-0.5">
        <span className="text-[#F59E0B] mt-[5px] shrink-0 text-[8px]">◆</span>
        <span className="text-[#D0D5E8] text-[13px] leading-relaxed">{nodes}</span>
      </div>
    );
  }
  if (/^\d+\.\s/.test(line)) {
    const num = line.match(/^(\d+)\./)?.[1];
    const rest = line.replace(/^\d+\.\s/, "");
    const restParts = rest.split(/\*\*(.*?)\*\*/g).map((p, i) =>
      i % 2 === 1 ? <strong key={i} className="text-[#E8EAF0]">{p}</strong> : p
    );
    return (
      <div key={key} className="flex gap-2 items-start pl-1 my-0.5">
        <span className="text-[#F59E0B] font-mono text-[10px] shrink-0 mt-[3px]">{num}.</span>
        <span className="text-[#D0D5E8] text-[13px] leading-relaxed">{restParts}</span>
      </div>
    );
  }
  if (line.trim() === "" || line.trim() === "---") return <div key={key} className="h-2" />;
  return (
    <p key={key} className="text-[#D0D5E8] text-[13px] leading-relaxed my-0.5">
      {nodes}
    </p>
  );
}

function MarkdownOutput({ text }: { text: string }) {
  return (
    <div className="space-y-0.5">
      {text.split("\n").map((line, i) => parseLine(line, i))}
    </div>
  );
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AgentStatus }) {
  const cls = {
    idle:    "bg-[#2A2F45]",
    running: "bg-amber-500 status-active",
    token:   "bg-amber-500 status-active",
    done:    "bg-emerald-500",
    error:   "bg-red-500",
  }[status];
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

// ─── AgentCard ────────────────────────────────────────────────────────────────

// Expected word count per agent — used to calculate % progress
const EXPECTED_WORDS: Record<keyof PipelineResults, number> = {
  profile_summary: 180,
  deep_research:   220,
  fitness_eval:    200,
  strategy:        160,
};

function AgentCard({ agentDef, result, index }: {
  agentDef: (typeof AGENTS)[0];
  result: AgentResult;
  index: number;
}) {
  const [copied, setCopied]   = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt   = useRef<number | null>(null);

  const isStreaming   = result.status === "running" || result.status === "token";
  const delayClass    = `fade-up-delay-${Math.min(index + 1, 4)}`;

  // Start/stop elapsed timer
  useEffect(() => {
    if (isStreaming) {
      if (!startedAt.current) startedAt.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (result.status !== "running") startedAt.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming, result.status]);

  // Reset timer on new run
  useEffect(() => {
    if (result.status === "idle") { setElapsed(0); startedAt.current = null; }
  }, [result.status]);

  // Auto-scroll while streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [result.output, isStreaming]);

  const copy = () => {
    navigator.clipboard.writeText(result.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Progress: token-driven from 5% → 95%, then snap to 100% on done
  const target = EXPECTED_WORDS[agentDef.key];
  const rawPct = result.status === "done"
    ? 100
    : result.status === "idle"
    ? 0
    : isStreaming && result.wordCount === 0
    ? 5   // "initializing" — show a sliver so it's obvious it started
    : Math.min(95, 5 + Math.round((result.wordCount / target) * 90));

  const pctLabel = result.status === "done"
    ? "100%"
    : result.status === "idle"
    ? ""
    : `${rawPct}%`;

  const displayStatus = isStreaming ? "running" : result.status;

  return (
    <div className={`intel-panel bracket-corner fade-up ${delayClass} rounded-sm overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2230] shrink-0">
        <div className="flex items-center gap-3">
          <StatusDot status={displayStatus} />
          <span style={{ color: agentDef.color }} className="text-sm">{agentDef.icon}</span>
          <div>
            <p className="text-xs font-mono text-[#E8EAF0] tracking-wider uppercase">{agentDef.label}</p>
            <p className="text-[10px] text-[#4A5170] mt-0.5">{agentDef.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Elapsed timer — visible while running */}
          {isStreaming && (
            <span className="text-[10px] font-mono text-[#4A5170] tabular-nums">
              {elapsed}s
            </span>
          )}
          {/* Percentage */}
          {(isStreaming || result.status === "done") && (
            <span className={`text-[10px] font-mono tabular-nums font-bold ${
              result.status === "done" ? "text-emerald-500" : "text-amber-500"
            }`}>
              {pctLabel}
            </span>
          )}
          {result.status === "done" && result.output && (
            <button onClick={copy} className="text-[#4A5170] hover:text-amber-500 transition-colors" title="Copy">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          <span className={`font-mono text-[10px] uppercase tracking-widest ${
            displayStatus === "idle"    ? "text-[#2A2F45]"  :
            displayStatus === "running" ? "text-amber-500"  :
            displayStatus === "done"    ? "text-emerald-500": "text-red-400"
          }`}>
            {isStreaming ? "writing…" : displayStatus}
          </span>
        </div>
      </div>

      {/* Progress bar — full width, 3px tall */}
      <div className="h-[3px] bg-[#1E2230] shrink-0">
        <div
          className={`h-full transition-all duration-300 ease-out ${
            result.status === "done"
              ? "bg-emerald-500"
              : result.status === "error"
              ? "bg-red-500"
              : "bg-amber-500"
          } ${isStreaming && result.wordCount === 0 ? "animate-pulse" : ""}`}
          style={{ width: `${rawPct}%` }}
        />
      </div>

      {/* Body — fixed height, scrollable */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ height: "252px" }}>
        {result.status === "idle" && (
          <div className="flex items-center justify-center h-full gap-2 text-[#2A2F45]">
            <span className="font-mono text-xs tracking-widest">— AWAITING SIGNAL —</span>
          </div>
        )}

        {isStreaming && result.output === "" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-amber-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="font-mono text-xs tracking-widest animate-pulse">CONNECTING TO MODEL…</span>
            <span className="text-[10px] font-mono text-[#4A5170]">{elapsed}s elapsed</span>
          </div>
        )}

        {isStreaming && result.output !== "" && (
          <div className="p-4">
            <MarkdownOutput text={result.output} />
            <span className="inline-block w-1.5 h-4 bg-amber-500 ml-0.5 animate-pulse align-middle" />
          </div>
        )}

        {result.status === "done" && (
          <div className="p-4">
            <MarkdownOutput text={result.output} />
          </div>
        )}

        {result.status === "error" && (
          <div className="flex items-start gap-3 p-4 text-red-400">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <p className="text-sm font-mono">{result.output}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Page() {
  const [linkedinPdf,     setLinkedinPdf]     = useState<File | null>(null);
  const [linkedinPdfName, setLinkedinPdfName] = useState("");
  const [resumeText,      setResumeText]      = useState("");
  const [resumePdf,       setResumePdf]       = useState<File | null>(null);
  const [resumePdfName,   setResumePdfName]   = useState("");
  const [results,         setResults]         = useState<PipelineResults>(DEFAULT_RESULTS);
  const [isRunning,       setIsRunning]       = useState(false);
  const [globalError,     setGlobalError]     = useState("");
  const [activeTab,       setActiveTab]       = useState<"results" | "raw">("results");

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const resumePdfRef    = useRef<HTMLInputElement>(null);
  const linkedinPdfRef  = useRef<HTMLInputElement>(null);
  const abortRef        = useRef<AbortController | null>(null);

  useEffect(() => { return () => abortRef.current?.abort(); }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setResumeText(ev.target?.result as string);
    reader.readAsText(file);
  };

  const handleLinkedinPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLinkedinPdf(file);
    setLinkedinPdfName(file.name);
  };

  const handleResumePdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumePdf(file);
    setResumePdfName(file.name);
    setResumeText("");
  };

  const handleRun = async () => {
    if (!linkedinPdf) return;
    if (isRunning) { abortRef.current?.abort(); return; }

    setGlobalError("");
    setIsRunning(true);
    setResults({
      profile_summary: { ...DEFAULT_RESULT },
      deep_research:   { ...DEFAULT_RESULT },
      fitness_eval:    { ...DEFAULT_RESULT },
      strategy:        { ...DEFAULT_RESULT },
    });
    abortRef.current = new AbortController();

    try {
      const pdfBase64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1]);
        r.onerror = () => rej(new Error("Failed to read LinkedIn PDF"));
        r.readAsDataURL(linkedinPdf);
      });

      let resumePdfBase64 = "";
      if (resumePdf) {
        resumePdfBase64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(",")[1]);
          r.onerror = () => rej(new Error("Failed to read resume PDF"));
          r.readAsDataURL(resumePdf);
        });
      }

      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_pdf: pdfBase64,
          resume: resumeText.trim(),
          resume_pdf: resumePdfBase64,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;

          try {
            const chunk: StreamChunk = JSON.parse(raw);

            setResults((prev) => {
              const cur = prev[chunk.agent];

              if (chunk.status === "running") {
                return { ...prev, [chunk.agent]: { ...cur, status: "running" } };
              }
              if (chunk.status === "token" && chunk.token) {
                const newOutput = cur.output + chunk.token;
                return {
                  ...prev,
                  [chunk.agent]: {
                    status: "token",
                    output: newOutput,
                    wordCount: newOutput.split(/\s+/).filter(Boolean).length,
                  },
                };
              }
              if (chunk.status === "done") {
                const text = chunk.output ?? cur.output;
                return {
                  ...prev,
                  [chunk.agent]: {
                    status: "done",
                    output: text,
                    wordCount: text.split(/\s+/).filter(Boolean).length,
                  },
                };
              }
              if (chunk.status === "error") {
                return {
                  ...prev,
                  [chunk.agent]: { status: "error", output: chunk.error ?? "Unknown error", wordCount: 0 },
                };
              }
              return prev;
            });
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setGlobalError("Pipeline aborted.");
      } else {
        setGlobalError(err instanceof Error ? err.message : "An unknown error occurred.");
      }
    } finally {
      setIsRunning(false);
    }
  };

  const completedCount = Object.values(results).filter((r) => r.status === "done").length;
  const hasAnyResult   = Object.values(results).some((r) => r.output);
  const allOutput      = AGENTS.map((a) => `## ${a.label}\n\n${results[a.key].output}`).join("\n\n---\n\n");

  return (
    <main className="min-h-screen grid-bg flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-[#1E2230] bg-[#08090C]/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className="absolute inset-0 border border-amber-500/40 rounded-sm rotate-45" />
              <Cpu size={14} className="text-amber-500" />
            </div>
            <div>
              <h1 className="font-mono text-sm tracking-[0.3em] text-[#E8EAF0] uppercase">ORACLE</h1>
              <p className="text-[9px] font-mono text-[#4A5170] tracking-[0.2em] uppercase">AI HR Outreach Intelligence System</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-[#4A5170] uppercase tracking-widest">
              <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-amber-500 status-active" : "bg-[#2A2F45]"}`} />
              {isRunning ? "Pipeline Active" : "Standby"}
            </div>
            {completedCount > 0 && (
              <div className="text-[10px] font-mono text-amber-500">{completedCount}/4 Complete</div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8">

        {/* ── Left: Input Panel ── */}
        <aside className="space-y-5">
          <div className="fade-up fade-up-delay-1">
            <p className="font-mono text-[10px] text-amber-500 tracking-[0.3em] uppercase mb-2">Intelligence Brief</p>
            <h2 className="font-display text-3xl text-[#E8EAF0] leading-tight" style={{ fontStyle: "italic" }}>
              Target an HR<br /><span className="text-amber-500">contact.</span>
            </h2>
            <p className="mt-3 text-sm text-[#8890AA] leading-relaxed">
              Upload a LinkedIn profile PDF and your resume. Four AI agents will research, evaluate, and craft a hyper-personalized outreach strategy.
            </p>
          </div>

          <div className="intel-panel bracket-corner rounded-sm p-5 space-y-5 fade-up fade-up-delay-2">
            {/* LinkedIn PDF */}
            <div className="space-y-2">
              <label className="font-mono text-[10px] text-[#4A5170] uppercase tracking-widest">LinkedIn Profile PDF</label>
              <div
                onClick={() => linkedinPdfRef.current?.click()}
                className={`flex items-center gap-3 bg-[#08090C] border rounded-sm px-3 py-3 cursor-pointer transition-colors ${linkedinPdfName ? "border-amber-500/60" : "border-[#2A2F45] hover:border-[#4A5170]"}`}
              >
                <Upload size={14} className={linkedinPdfName ? "text-amber-500" : "text-[#4A5170]"} />
                <span className={`text-sm font-mono truncate ${linkedinPdfName ? "text-[#E8EAF0]" : "text-[#2A2F45]"}`}>
                  {linkedinPdfName || "Upload LinkedIn profile PDF…"}
                </span>
              </div>
              <p className="text-[10px] text-[#4A5170]">Export target's LinkedIn profile as PDF and upload here.</p>
              <input ref={linkedinPdfRef} type="file" accept=".pdf" className="hidden" onChange={handleLinkedinPdf} />
            </div>

            {/* Resume */}
            <div className="space-y-2">
              <label className="font-mono text-[10px] text-[#4A5170] uppercase tracking-widest">Your Resume</label>
              <textarea
                value={resumeText}
                onChange={(e) => { setResumeText(e.target.value); if (e.target.value) { setResumePdf(null); setResumePdfName(""); } }}
                placeholder="Paste your resume text here…"
                rows={6}
                className="w-full bg-[#08090C] border border-[#2A2F45] rounded-sm p-3 text-sm text-[#D0D5E8] placeholder-[#2A2F45] outline-none font-body resize-none focus:border-amber-500/60 transition-colors leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <div className="section-divider flex-1 text-[10px]">
                  <span className="font-mono">or upload</span>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-[10px] font-mono text-[#4A5170] hover:text-amber-500 transition-colors uppercase tracking-widest border border-[#2A2F45] hover:border-amber-500/40 rounded-sm px-3 py-1.5"
                >
                  <Upload size={11} /> .txt / .md
                </button>
                <button
                  onClick={() => resumePdfRef.current?.click()}
                  className={"flex items-center gap-2 text-[10px] font-mono transition-colors uppercase tracking-widest border rounded-sm px-3 py-1.5 " + (resumePdfName ? "text-amber-500 border-amber-500/60" : "text-[#4A5170] hover:text-amber-500 border-[#2A2F45] hover:border-amber-500/40")}
                >
                  <Upload size={11} />
                  {resumePdfName ? resumePdfName.slice(0, 10) + "…" : ".pdf"}
                </button>
                <input ref={fileInputRef}   type="file" accept=".txt,.md" className="hidden" onChange={handleFileUpload} />
                <input ref={resumePdfRef}   type="file" accept=".pdf"     className="hidden" onChange={handleResumePdf} />
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={handleRun}
              disabled={!linkedinPdf && !isRunning}
              className={`w-full py-3 rounded-sm font-mono text-xs tracking-[0.25em] uppercase transition-all flex items-center justify-center gap-3 ${
                isRunning
                  ? "bg-[#1E2230] border border-red-500/40 text-red-400 hover:bg-red-500/10"
                  : linkedinPdf
                  ? "bg-amber-500 text-[#08090C] hover:bg-amber-400 amber-glow font-bold"
                  : "bg-[#141720] text-[#2A2F45] cursor-not-allowed border border-[#1E2230]"
              }`}
            >
              {isRunning ? (
                <><Loader2 size={14} className="animate-spin" /> Abort Pipeline</>
              ) : (
                <><ChevronRight size={14} /> Launch Intelligence Sweep</>
              )}
            </button>
          </div>

          {/* Pipeline progress sidebar */}
          <div className="intel-panel rounded-sm p-4 fade-up fade-up-delay-3">
            <p className="font-mono text-[9px] text-[#4A5170] uppercase tracking-widest mb-3">Agent Pipeline</p>
            <div className="space-y-3">
              {AGENTS.map((agent) => {
                const res     = results[agent.key];
                const isActive = res.status === "running" || res.status === "token";
                const target  = EXPECTED_WORDS[agent.key];
                const pct     = res.status === "done"  ? 100
                              : res.status === "idle"  ? 0
                              : isActive && res.wordCount === 0 ? 5
                              : Math.min(95, 5 + Math.round((res.wordCount / target) * 90));
                return (
                  <div key={agent.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot status={res.status === "token" ? "running" : res.status} />
                        <span className="text-[11px] text-[#8890AA]">{agent.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-mono tabular-nums font-bold ${
                          res.status === "done" ? "text-emerald-500" :
                          isActive              ? "text-amber-500"   : "text-[#2A2F45]"
                        }`}>
                          {res.status !== "idle" ? `${pct}%` : ""}
                        </span>
                        <span className={`text-[9px] font-mono uppercase ${
                          res.status === "done" ? "text-emerald-500" :
                          isActive              ? "text-amber-500"   : "text-[#2A2F45]"
                        }`}>
                          {isActive ? "active" : res.status === "done" ? "done" : res.status}
                        </span>
                      </div>
                    </div>
                    <div className="h-[2px] bg-[#1E2230] rounded overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          res.status === "done" ? "bg-emerald-500" : "bg-amber-500"
                        } ${isActive && res.wordCount === 0 ? "animate-pulse" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {globalError && (
            <div className="intel-panel rounded-sm p-4 border-red-500/30 flex items-start gap-3 text-red-400">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p className="text-sm">{globalError}</p>
            </div>
          )}
        </aside>

        {/* ── Right: Results ── */}
        <section className="flex flex-col gap-5">
          {hasAnyResult && (
            <div className="flex items-center gap-4 fade-up">
              <div className="flex border border-[#1E2230] rounded-sm overflow-hidden">
                {(["results", "raw"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                      activeTab === tab ? "bg-amber-500 text-[#08090C]" : "text-[#4A5170] hover:text-[#E8EAF0]"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[10px] text-[#4A5170] uppercase tracking-widest">Intelligence Output</span>
            </div>
          )}

          {activeTab === "results" && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {AGENTS.map((agent, i) => (
                <AgentCard key={agent.key} agentDef={agent} result={results[agent.key]} index={i} />
              ))}
            </div>
          )}

          {activeTab === "raw" && hasAnyResult && (
            <div className="intel-panel rounded-sm p-5 fade-up">
              <div className="flex justify-between items-center mb-4">
                <p className="font-mono text-[10px] text-[#4A5170] uppercase tracking-widest">Raw Output</p>
                <button
                  onClick={() => navigator.clipboard.writeText(allOutput)}
                  className="flex items-center gap-2 text-[10px] font-mono text-[#4A5170] hover:text-amber-500 transition-colors uppercase tracking-widest"
                >
                  <Copy size={11} /> Copy All
                </button>
              </div>
              <pre className="text-xs text-[#8890AA] leading-relaxed whitespace-pre-wrap font-mono overflow-auto max-h-[60vh]">
                {allOutput}
              </pre>
            </div>
          )}

          {!hasAnyResult && !isRunning && (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] gap-6 fade-up fade-up-delay-1">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 border border-[#1E2230] rounded-full" />
                <div className="absolute inset-3 border border-[#2A2F45] rounded-full" />
                <div className="absolute inset-6 border border-amber-500/20 rounded-full" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Cpu size={24} className="text-[#2A2F45]" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <p className="font-mono text-sm text-[#4A5170] tracking-widest uppercase">No Active Mission</p>
                <p className="text-xs text-[#2A2F45]">Upload a LinkedIn PDF and launch the pipeline to begin.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                {AGENTS.map((agent) => (
                  <div key={agent.key} className="intel-panel rounded-sm p-3 flex items-center gap-2">
                    <span style={{ color: agent.color }} className="opacity-40">{agent.icon}</span>
                    <span className="text-[10px] text-[#2A2F45] font-mono">{agent.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="border-t border-[#1E2230] py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <p className="font-mono text-[9px] text-[#2A2F45] uppercase tracking-widest">Oracle — AI HR Outreach Intelligence System</p>
          <p className="font-mono text-[9px] text-[#2A2F45] uppercase tracking-widest">Powered by OpenAI + FastAPI</p>
        </div>
      </footer>
    </main>
  );
}