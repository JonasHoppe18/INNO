"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAgentPersonaConfig } from "@/hooks/useAgentPersonaConfig";
import {
  Bold,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Italic,
  List,
  Loader2,
  Play,
  Quote,
  RefreshCw,
  Sparkles,
  Underline,
} from "lucide-react";

const TOOLBAR_BUTTONS = [
  { icon: Bold, label: "Bold" },
  { icon: Italic, label: "Italic" },
  { icon: Underline, label: "Underline" },
  { icon: List, label: "List" },
  { icon: Quote, label: "Quote" },
];

const FineTuningPanelContext = createContext(null);

export function useFineTuningPanelActions() {
  const ctx = useContext(FineTuningPanelContext);
  if (!ctx) {
    throw new Error("useFineTuningPanelActions must be used inside FineTuningPanel");
  }
  return ctx;
}

export function FineTuningPanel({ children }) {
  const { persona, loading, saving, error, save, refresh, test, testPersona } =
    useAgentPersonaConfig();

  const [instructions, setInstructions] = useState("");
  const [dirty, setDirty] = useState(false);

  // Generated email state
  const [generatedEmail, setGeneratedEmail] = useState(null);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const testErrorMessage = useMemo(() => {
    if (!test?.error) return null;
    return test.error instanceof Error ? test.error.message : String(test.error);
  }, [test?.error]);

  useEffect(() => {
    setInstructions(persona?.instructions ?? "");
    setDirty(false);
  }, [persona?.instructions]);


  const handleChange = (event) => {
    setInstructions(event.target.value);
    setDirty(true);
  };

  const handleSave = useCallback(() => {
    save({ instructions })
      .then(() => setDirty(false))
      .catch(() => null);
  }, [instructions, save]);

  const handleRefresh = useCallback(() => refresh().catch(() => null), [refresh]);

  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    setGenerateError(null);
    try {
      const response = await fetch("/api/fine-tuning/generate-email", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Could not generate email.");
      }
      setGeneratedEmail(data);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not generate email.");
    } finally {
      setGeneratingEmail(false);
    }
  };

  const handleRunTest = () => {
    if (!generatedEmail?.body) return;
    testPersona({
      scenario: generatedEmail.body,
      instructions,
      signature: "",
      emailLanguage: generatedEmail.language ?? null,
    }).catch(() => null);
  };

  const contextValue = useMemo(
    () => ({ refresh: handleRefresh, save: handleSave, loading, saving, dirty }),
    [handleRefresh, handleSave, loading, saving, dirty]
  );

  return (
    <FineTuningPanelContext.Provider value={contextValue}>
      {children || null}
      <Card className="overflow-hidden border-0 bg-white shadow-none">
        <CardContent className="bg-white">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(500px,1fr)]">
            {/* Left column: Instructions editor */}
            <div className="space-y-5">
              <EditorField
                label="Instructions"
                description="Describe how the AI should behave, open and close its replies, and what it can promise. The AI understands context — you can write conditional rules."
                value={instructions}
                onChange={handleChange}
                placeholder={`Examples:
- Start first replies by thanking the customer for reaching out and showing empathy for their issue.
- Close with "I look forward to hearing from you" when the issue is still being troubleshot, and "Have a great day!" when a solution has been given.
- Never promise a refund without first checking the order date.
- Always sign off with the agent's first name only.`}
                rows={14}
              />
              {error && (
                <p className="text-sm text-destructive">
                  {error.message ?? "Could not load or save instructions."}
                </p>
              )}
            </div>

            {/* Right column: Playground */}
            <aside className="flex flex-col rounded-2xl border bg-card/70 shadow-sm lg:sticky lg:top-6 lg:mt-4 lg:min-h-[900px]">
              <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Playground</p>
                  <p className="text-xs text-muted-foreground">
                    Generate a test email and see how the AI responds.
                  </p>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Live
                </Badge>
              </div>

              <div className="flex flex-1 flex-col gap-5 px-4 py-4">
                {/* Step 1: Generated email */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-foreground">
                        Test email
                      </label>
                      {generatedEmail?.language && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0">
                          {generatedEmail.language === "Danish" ? "DA" : "EN"}
                        </Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateEmail}
                      disabled={generatingEmail}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-accent disabled:opacity-50"
                    >
                      {generatingEmail ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {generatingEmail ? "Generating…" : "Generate email"}
                    </button>
                  </div>

                  {generateError ? (
                    <p className="text-xs text-destructive">{generateError}</p>
                  ) : null}

                  <div className="rounded-xl border bg-slate-50 p-3 text-xs text-muted-foreground">
                    {generatingEmail ? (
                      <div className="space-y-2">
                        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
                        <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                        <div className="mt-2 h-3 w-full animate-pulse rounded bg-slate-200" />
                        <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
                      </div>
                    ) : generatedEmail ? (
                      <div className="space-y-1.5">
                        <p>
                          <span className="font-semibold text-slate-700">From:</span>{" "}
                          {generatedEmail.from}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Subject:</span>{" "}
                          {generatedEmail.subject}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-slate-600">
                          {generatedEmail.body}
                        </p>
                      </div>
                    ) : (
                      <p>Click &quot;Generate email&quot; to create a test scenario based on your shop.</p>
                    )}
                  </div>
                </div>

                {/* Step 2: AI response */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">AI response</p>
                    <button
                      type="button"
                      onClick={handleRunTest}
                      disabled={test?.loading || !generatedEmail?.body}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
                      aria-label="Run test"
                    >
                      {test?.loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {test?.loading ? "Running…" : "Run"}
                    </button>
                  </div>

                  {testErrorMessage ? (
                    <p className="text-xs text-destructive">{testErrorMessage}</p>
                  ) : null}

                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="min-h-[300px] text-sm leading-relaxed text-foreground">
                      {test?.loading ? (
                        <div className="space-y-2">
                          <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200" />
                          <div className="h-3.5 w-full animate-pulse rounded bg-slate-200" />
                          <div className="h-3.5 w-11/12 animate-pulse rounded bg-slate-200" />
                          <div className="h-3.5 w-1/2 animate-pulse rounded bg-slate-200" />
                        </div>
                      ) : test?.result ? (
                        <p className="whitespace-pre-wrap">{test.result}</p>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          Generate an email above, then click &quot;Run&quot; to see how the AI responds with your current instructions.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </CardContent>
      </Card>
      <EvalSection />
    </FineTuningPanelContext.Provider>
  );
}

// ─── Eval Panel ──────────────────────────────────────────────────────────────

function ScoreBadge({ value }) {
  const color =
    value >= 4 ? "bg-emerald-100 text-emerald-700" :
    value === 3 ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${color}`}>
      {value}/5
    </span>
  );
}

function EvalResultRow({ result }) {
  const [open, setOpen] = useState(false);
  const label = result.ticket_subject || (result.thread_id ? result.thread_id.slice(0, 8) + "…" : "Email");
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate font-medium text-slate-700">{label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground">Overall</span>
          <ScoreBadge value={result.overall} />
        </div>
      </button>
      {open && (
        <div className="bg-slate-50 px-4 pb-3 pt-1 text-xs space-y-2">
          <div className="flex flex-wrap gap-3">
            {[["Correctness", result.correctness], ["Completeness", result.completeness], ["Tone", result.tone], ["Actionability", result.actionability]].map(([lbl, val]) => (
              <div key={lbl} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{lbl}</span>
                <ScoreBadge value={val} />
              </div>
            ))}
          </div>
          {result.reasoning && <p className="text-slate-600 italic">{result.reasoning}</p>}
          {result.ticket_body && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Customer email</summary>
              <p className="mt-1 whitespace-pre-wrap rounded border bg-white p-2 text-slate-700">{result.ticket_body}</p>
            </details>
          )}
          {result.draft_content && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Draft</summary>
              <p className="mt-1 whitespace-pre-wrap rounded border bg-white p-2 text-slate-700">{result.draft_content}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_EMAIL = () => ({ id: Math.random().toString(36).slice(2), subject: "", body: "" });
const MODELS = ["gpt-4o", "gpt-4o-mini"];

function EvalSection() {
  const [emails, setEmails] = useState([EMPTY_EMAIL()]);
  const [runLabel, setRunLabel] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [expandedRun, setExpandedRun] = useState(null);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/eval/results", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setRuns(data?.runs ?? []);
    } catch { /* silent */ } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const addEmail = () => setEmails((prev) => [...prev, EMPTY_EMAIL()]);
  const removeEmail = (id) => setEmails((prev) => prev.filter((e) => e.id !== id));
  const updateEmail = (id, field, value) =>
    setEmails((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));

  const handleRun = async () => {
    const validEmails = emails.filter((e) => e.body.trim());
    if (!runLabel.trim() || validEmails.length === 0) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/eval/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: validEmails.map((e) => ({ subject: e.subject, body: e.body })),
          run_label: runLabel.trim(),
          model,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Eval failed");
      await fetchRuns();
      setExpandedRun(runLabel.trim());
      setRunLabel("");
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const hasValidEmails = emails.some((e) => e.body.trim());

  return (
    <Card className="mt-8 overflow-hidden border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">Draft quality eval</p>
            <p className="text-xs text-muted-foreground">Paste customer emails, run them through the AI, and get a quality score (1–5) on correctness, completeness, tone and actionability.</p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-6 pt-5">
        {/* Email inputs */}
        <div className="space-y-3">
          {emails.map((email, idx) => (
            <div key={email.id} className="rounded-xl border bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Email {idx + 1}</span>
                {emails.length > 1 && (
                  <button type="button" onClick={() => removeEmail(email.id)} className="text-xs text-muted-foreground hover:text-destructive transition-colors">Remove</button>
                )}
              </div>
              <input
                type="text"
                value={email.subject}
                onChange={(e) => updateEmail(email.id, "subject", e.target.value)}
                placeholder="Subject (optional)"
                className="w-full rounded-lg border border-input bg-white px-3 py-1.5 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <textarea
                value={email.body}
                onChange={(e) => updateEmail(email.id, "body", e.target.value)}
                placeholder="Paste customer email here…"
                rows={4}
                className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addEmail}
            className="text-xs text-blue-600 hover:text-blue-500 transition-colors font-medium"
          >
            + Add email
          </button>
        </div>

        {/* Run controls */}
        <div className="flex gap-2">
          <input
            type="text"
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
            placeholder='Run label, e.g. "gpt-4o baseline"'
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleRun}
            disabled={running || !runLabel.trim() || !hasValidEmails}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running…" : "Run eval"}
          </button>
        </div>
        {runError && <p className="text-xs text-destructive">{runError}</p>}

        {/* Results */}
        {loadingRuns ? (
          <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
        ) : runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No eval runs yet.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-medium text-slate-600">Previous runs</p>
            {runs.map((run) => (
              <div key={run.run_label} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setExpandedRun(expandedRun === run.run_label ? null : run.run_label)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {expandedRun === run.run_label ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm font-semibold text-slate-800">{run.run_label}</span>
                    <span className="text-xs text-muted-foreground">{run.count} email{run.count !== 1 ? "s" : ""} · {run.model}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {[["Corr", run.averages.correctness], ["Comp", run.averages.completeness], ["Tone", run.averages.tone], ["Act", run.averages.actionability]].map(([abbr, val]) => (
                      <span key={abbr} className="hidden text-muted-foreground sm:inline">
                        {abbr} <span className="font-medium text-slate-700">{val}</span>
                      </span>
                    ))}
                    <span className="ml-1 inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                      {run.averages.overall} avg
                    </span>
                  </div>
                </button>
                {expandedRun === run.run_label && (
                  <div className="border-t">
                    {run.results.map((r) => <EvalResultRow key={r.id} result={r} />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EditorField({ label, description, value, onChange, placeholder, rows = 5 }) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-1.5 border-b border-gray-200 bg-gray-50 px-3 py-2">
          {TOOLBAR_BUTTONS.map(({ icon: Icon, label: buttonLabel }) => (
            <span
              key={buttonLabel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground"
              role="presentation"
              aria-hidden="true"
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          ))}
        </div>
        <Textarea
          value={value}
          onChange={onChange}
          rows={rows}
          className="min-h-[120px] resize-y border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2"
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
