"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  Sparkles,
  Underline,
} from "lucide-react";

const DEFAULT_INSTRUCTIONS = `TONE OG STIL — gælder på alle sprog:

Åbning (kun første svar i en tråd):
Start altid med en kort, varm indledning på kundens sprog. Tak kunden for at henvende sig og vis empati for problemet. Eksempel på dansk: "Tak fordi du kontakter os. Vi er kede af at høre, at du oplever problemer med [produkt]." — tilpas til kundens sprog og skriv altid indledningen på samme sprog som kunden.
Gå direkte til løsning efter indledningen — skriv aldrig kundens problem om med egne ord.

Opfølgningssvar (kunden har allerede skrevet):
Spring indledningen over — gå direkte til sagen.

Afslutning — vurdér altid situationen og skriv på kundens sprog:
- Konkrete trin givet, afventer resultat: "Jeg ser frem til at høre fra dig."
- Problemet løst eller ombytning aftalt: "God dag!"
- Frustreret kunde eller lang ventetid: "Undskyld for ulejligheden og tak for din tålmodighed."`;

// Dummy toolbar data – ren kosmetik men hjælper med at beskrive editoren.
const TOOLBAR_BUTTONS = [
  { icon: Bold, label: "Bold" },
  { icon: Italic, label: "Italic" },
  { icon: Underline, label: "Underline" },
  { icon: List, label: "List" },
  { icon: Quote, label: "Quote" },
];

const PersonaPanelContext = createContext(null);

export function usePersonaPanelActions() {
  const ctx = useContext(PersonaPanelContext);
  if (!ctx) {
    throw new Error("usePersonaPanelActions must be used inside PersonaPanel");
  }
  return ctx;
}

export function PersonaPanel({ children }) {
  const { persona, loading, saving, error, save, refresh, test, testPersona } =
    useAgentPersonaConfig();
  // Formularstate for signatur/instruktioner hentes og lagres via hooken.
  const [form, setForm] = useState({
    signature: "",
    instructions: "",
    brand_description: "",
    support_identity: "",
  });
  // Dirty flag styrer hvornår gem-knappen skal aktiveres.
  const [dirty, setDirty] = useState(false);
  // Playground input til test endpointet.
  const [scenarioInput, setScenarioInput] = useState("");
  // Konverterer test hookens error til en streng til UI.
  const testErrorMessage = useMemo(() => {
    if (!test?.error) return null;
    return test.error instanceof Error ? test.error.message : String(test.error);
  }, [test?.error]);

  // Når persona data ændrer sig synker vi formularen og rydder dirty flag.
  // Nye shops uden instructions får default-teksten pre-filled.
  useEffect(() => {
    setForm({
      signature: persona?.signature ?? "",
      instructions: persona?.instructions || DEFAULT_INSTRUCTIONS,
      brand_description: persona?.brand_description ?? "",
      support_identity: persona?.support_identity ?? "",
    });
    setScenarioInput(persona?.scenario ?? "");
    setDirty(false);
  }, [persona?.signature, persona?.scenario, persona?.instructions, persona?.brand_description, persona?.support_identity]);

  // Generisk onChange der opdaterer form state.
  const handleChange = (key) => (event) => {
    const value = event.target.value;
    setDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Wrapper save hooken og nulstiller dirty når kaldet lykkes.
  const handleSave = useCallback(() => {
    save(form).then(() => setDirty(false)).catch(() => null);
  }, [form, save]);

  // Sender midlertidige felter til backend test-funktionen.
  const handleTest = () => {
    testPersona({ ...form, scenario: scenarioInput }).catch(() => null);
  };

  // Force reload af persona fra backend.
  const handleRefresh = useCallback(() => refresh().catch(() => null), [refresh]);

  // Contextens API bruges af headeren til at trigge refresh/save.
  const contextValue = useMemo(
    () => ({
      refresh: handleRefresh,
      save: handleSave,
      loading,
      saving,
      dirty,
    }),
    [handleRefresh, handleSave, loading, saving, dirty]
  );

  return (
    <PersonaPanelContext.Provider value={contextValue}>
      {children || null}
      <Card className="overflow-hidden border-0 bg-white shadow-none">
        <CardContent className="bg-white">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
          <div className="space-y-5">
            {/* Shop identity */}
            <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Shop identity</p>
                <p className="text-xs text-muted-foreground">
                  Tells the AI who it represents. Auto-populated from Shopify — edit to refine.
                </p>
              </div>
              {persona?.shop_name && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Shop name</p>
                  <p className="text-sm font-semibold text-slate-800">{persona.shop_name}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Brand description</p>
                <textarea
                  value={form.brand_description}
                  onChange={handleChange("brand_description")}
                  rows={2}
                  placeholder={persona?.shop_name ? `${persona.shop_name} er en dansk webshop...` : "Beskriv hvad jeres shop sælger og til hvem."}
                  className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Support identity</p>
                <textarea
                  value={form.support_identity}
                  onChange={handleChange("support_identity")}
                  rows={3}
                  placeholder="Du er en del af [shop]'s supportteam. Du ER supporten — henvis aldrig kunden videre."
                  className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
            </div>

            <EditorField
              label="Signature"
              description="Shown at the bottom of every reply - supports line breaks."
              value={form.signature}
              onChange={handleChange("signature")}
              placeholder={"Best regards\n Sona AI"}
              rows={4}
            />
            <EditorField
              label="Instructions"
              description="Tone of voice, what the agent can promise, and how to reply."
              value={form.instructions}
              onChange={handleChange("instructions")}
              placeholder="Keep the tone warm and solution-oriented..."
              rows={8}
            />
            {error && (
              <p className="text-sm text-destructive">
                {error.message ?? "Could not load/save persona."}
              </p>
            )}
          </div>
          <aside className="flex flex-col rounded-2xl border bg-card/70 shadow-sm lg:sticky lg:top-6 lg:mt-4">
            <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Playground</p>
                <p className="text-xs text-muted-foreground">
                  Test scenarios without saving settings.
                </p>
              </div>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                Live
              </Badge>
            </div>
            <div className="flex flex-1 flex-col gap-5 px-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="scenario-test-input">
                  Test a scenario
                </label>
                <div className="relative">
                  <Textarea
                    id="scenario-test-input"
                    value={scenarioInput}
                    onChange={(event) => setScenarioInput(event.target.value)}
                    rows={4}
                    className="min-h-[110px] resize-y border border-input bg-background px-3 py-3 text-sm shadow-inner focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2"
                    placeholder="Hi! I can't find order #1001 - can you help?"
                  />
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={test?.loading || loading || !scenarioInput.trim()}
                    className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-500 disabled:opacity-50"
                    aria-label="Run test"
                  >
                    {test?.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {testErrorMessage ? (
                  <p className="text-xs text-destructive">{testErrorMessage}</p>
                ) : null}
              </div>
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">AI output</p>
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="mb-4 rounded-lg border bg-slate-50 px-4 py-3 text-xs text-muted-foreground">
                      <p>
                        <span className="font-semibold text-slate-800">From:</span> Customer
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Subject:</span> Re: Order #1001
                      </p>
                    </div>
                    <div className="min-h-[140px] text-sm leading-relaxed text-foreground">
                      {test?.loading ? (
                        <div className="space-y-3">
                          <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200" />
                          <div className="h-3.5 w-full animate-pulse rounded bg-slate-200" />
                          <div className="h-3.5 w-11/12 animate-pulse rounded bg-slate-200" />
                          <div className="h-3.5 w-1/2 animate-pulse rounded bg-slate-200" />
                        </div>
                      ) : test?.result ? (
                        <p className="whitespace-pre-wrap">{test.result}</p>
                      ) : (
                        <p className="text-muted-foreground">
                          Write a scenario to see how the agent responds with your current
                          configuration.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
        </CardContent>
      </Card>
    </PersonaPanelContext.Provider>
  );
}

function EditorField({ label, description, value, onChange, placeholder, rows = 5 }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
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
