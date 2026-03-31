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
  const [replyGreeting, setReplyGreeting] = useState("");
  const [dirty, setDirty] = useState(false);
  const [greetingSaving, setGreetingSaving] = useState(false);

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

  // Load reply greeting from shops table
  useEffect(() => {
    fetch("/api/settings/company-context")
      .then((r) => r.json())
      .then((data) => { if (data?.reply_greeting != null) setReplyGreeting(data.reply_greeting); })
      .catch(() => null);
  }, []);

  const handleSaveGreeting = useCallback(async () => {
    setGreetingSaving(true);
    try {
      await fetch("/api/settings/company-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_greeting: replyGreeting }),
      });
    } catch (_err) {
      // ignore
    } finally {
      setGreetingSaving(false);
    }
  }, [replyGreeting]);

  const handleChange = (event) => {
    setInstructions(event.target.value);
    setDirty(true);
  };

  const handleSave = useCallback(() => {
    save({ instructions, signature: persona?.signature ?? "" })
      .then(() => setDirty(false))
      .catch(() => null);
  }, [instructions, persona?.signature, save]);

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
                description="Define the AI's tone of voice, what it can promise, and how it should reply. This is applied to every response the AI generates."
                value={instructions}
                onChange={handleChange}
                placeholder="Example: Always be empathetic and solution-oriented. Never promise refunds without checking the order date. Sign off with the agent's first name only."
                rows={14}
              />
              {error && (
                <p className="text-sm text-destructive">
                  {error.message ?? "Could not load or save instructions."}
                </p>
              )}

              {/* Reply greeting — only injected on first message in a thread */}
              <div className="space-y-1.5">
                <div>
                  <p className="text-sm font-semibold text-foreground">Opening style</p>
                  <p className="text-xs text-muted-foreground">
                    Describe how the AI should open its first reply. Leave empty for a direct response without a warm intro. Only applied on the first message — not follow-ups.
                  </p>
                </div>
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <textarea
                    value={replyGreeting}
                    onChange={(e) => setReplyGreeting(e.target.value)}
                    rows={4}
                    className="w-full resize-y border-0 bg-transparent px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Example: Start by thanking the customer for reaching out and expressing empathy about their issue before providing the solution."
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveGreeting}
                  disabled={greetingSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {greetingSaving ? "Saving…" : "Save opening style"}
                </button>
              </div>
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
    </FineTuningPanelContext.Provider>
  );
}

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
