"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  Lightbulb,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

const TYPE_LABELS = {
  knowledge_gap_suggestion: "Knowledge gap",
  knowledge_doc_update_suggestion: "Doc update",
  eval_golden_case_suggestion: "Golden case",
  writer_style_rule_suggestion: "Style rule",
  safety_guardrail_suggestion: "Guardrail",
  product_compatibility_data_suggestion: "Compatibility data",
};

const ROOT_CAUSE_STYLE = {
  missing_knowledge: "bg-amber-50 text-amber-700 border-amber-200",
  incorrect_policy: "bg-red-50 text-red-700 border-red-200",
  product_specific: "bg-blue-50 text-blue-700 border-blue-200",
  live_fact_tracking: "bg-cyan-50 text-cyan-700 border-cyan-200",
  refund_return_nuance: "bg-orange-50 text-orange-700 border-orange-200",
  compatibility: "bg-indigo-50 text-indigo-700 border-indigo-200",
  style_tone: "bg-purple-50 text-purple-700 border-purple-200",
  too_verbose: "bg-purple-50 text-purple-700 border-purple-200",
  unclear_intent: "bg-gray-100 text-gray-600 border-gray-200",
  other: "bg-gray-100 text-gray-600 border-gray-200",
  insufficient_data: "bg-gray-100 text-gray-500 border-gray-200",
};

const STATUS_TABS = [
  { key: "suggested", label: "Til review" },
  { key: "approved", label: "Godkendt" },
  { key: "rejected", label: "Afvist" },
  { key: "all", label: "Alle" },
];

export function FeedbackSuggestionsPanel() {
  const [statusTab, setStatusTab] = useState("suggested");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(async (status) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/feedback/suggestions?status=${encodeURIComponent(status)}&limit=100`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Kunne ikke hente forslag");
      setRows(body.rows || []);
      setCounts(body.counts || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(statusTab);
  }, [statusTab, load]);

  const review = useCallback(
    async (id, nextStatus) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/feedback/suggestions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: nextStatus,
            review_note: notes[id] || null,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Review fejlede");
        await load(statusTab);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusyId(null);
      }
    },
    [notes, statusTab, load],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-semibold">Læringsforslag</h2>
        <span className="text-sm text-muted-foreground">
          {counts.suggested || 0} venter på review
        </span>
      </div>

      <div className="flex gap-1">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={statusTab === tab.key ? "default" : "outline"}
            onClick={() => setStatusTab(tab.key)}
          >
            {tab.label}
            {tab.key !== "all" && counts[tab.key] ? ` (${counts[tab.key]})` : ""}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Henter forslag…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          Ingen forslag i denne visning.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {TYPE_LABELS[row.suggestion_type] || row.suggestion_type}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={ROOT_CAUSE_STYLE[row.root_cause] || ""}
                  >
                    {row.root_cause}
                  </Badge>
                  {row.confidence != null ? (
                    <span className="text-xs text-muted-foreground">
                      conf {Number(row.confidence).toFixed(2)}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleDateString("da-DK")}
                  </span>
                </div>

                <p className="text-sm">
                  {row.proposed_change_summary || (
                    <span className="italic text-muted-foreground">
                      (ingen beskrivelse)
                    </span>
                  )}
                </p>

                {row.status === "suggested" ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Valgfri review-note…"
                      value={notes[row.id] || ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                      }
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, "approved")}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Godkend
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, "rejected")}
                      >
                        <XCircle className="mr-1 h-4 w-4" /> Afvis
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, "reviewed")}
                      >
                        <Eye className="mr-1 h-4 w-4" /> Set (afgør senere)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {row.status}
                    {row.review_note ? ` — ${row.review_note}` : ""}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
