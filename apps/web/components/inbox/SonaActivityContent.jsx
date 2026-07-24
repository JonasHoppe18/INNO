"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  History,
  PackageSearch,
  Plus,
  Send,
} from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  describeKnowledgeContent,
  describeKnowledgeSource,
  formatOrderNumber,
} from "@/lib/inbox/sona-source";
import { cn } from "@/lib/utils";

const INTENT_LABELS = {
  tracking: "Shipment tracking",
  return: "Return request",
  refund: "Refund request",
  exchange: "Exchange request",
  address_change: "Address change",
  product_question: "Product question",
  complaint: "Complaint",
  thanks: "Thank-you message",
  update: "Status update",
  other: "General inquiry",
};

const ROUTING_LABELS = {
  auto: "Draft ready",
  review: "Marked for human review",
  block: "Held for review",
};

const RESOLUTION_META = {
  clarify_symptom: {
    label: "Ask a focused follow-up",
    description: "Clarify the customer’s issue before suggesting a solution.",
  },
  troubleshoot_first: {
    label: "Guide the customer through troubleshooting",
    description: "Try the relevant troubleshooting steps before moving to a return or warranty case.",
  },
  request_evidence: {
    label: "Request supporting evidence",
    description: "Ask for the photos or details needed before deciding the next step.",
  },
  initiate_warranty_repair: {
    label: "Start the warranty or repair process",
    description: "Guide the customer through the next steps for warranty handling or repair.",
  },
  cancel_order: {
    label: "Help cancel the order",
    description: "Confirm the order state and explain or complete the cancellation process.",
  },
  refund_or_exchange: {
    label: "Explain the refund or exchange options",
    description: "Use the verified order context and policy to tell the customer how to proceed.",
  },
  escalate_human: {
    label: "Hand the case to a teammate",
    description: "The request needs human review before a reply or action is completed.",
  },
};

const INFO_OUTCOMES = {
  tracking: {
    label: () => "Share the latest delivery update",
    goal: "tell the customer where the shipment is and what happens next",
  },
  return: {
    label: (order) => `Explain how to return ${order ? `order ${order}` : "the order"}`,
    goal: "give the customer clear return instructions",
  },
  refund: {
    label: (order) => `Explain the refund options${order ? ` for order ${order}` : ""}`,
    goal: "explain the available refund options and next steps",
  },
  exchange: {
    label: (order) => `Explain how to exchange${order ? ` order ${order}` : " the order"}`,
    goal: "give the customer clear exchange instructions",
  },
  address_change: {
    label: () => "Explain the address-change options",
    goal: "tell the customer whether the address can still be changed and what to do next",
  },
  product_question: {
    label: () => "Answer the product question",
    goal: "give a specific answer using the available product information",
  },
  complaint: {
    label: () => "Respond with the recommended next step",
    goal: "acknowledge the issue and guide the customer toward the appropriate next step",
  },
  thanks: {
    label: () => "Acknowledge the customer",
    goal: "send a brief and helpful acknowledgement",
  },
  update: {
    label: () => "Confirm the customer’s update",
    goal: "acknowledge the new information and confirm what happens next",
  },
  other: {
    label: () => "Answer the customer’s request",
    goal: "give the customer a clear and relevant answer",
  },
};

function joinReferences(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function replyOutcomeMeta({ intent, resolutionStage, orderNumber, orderFound, knowledge }) {
  if (resolutionStage && resolutionStage !== "info_only" && RESOLUTION_META[resolutionStage]) {
    return RESOLUTION_META[resolutionStage];
  }

  const outcome = INFO_OUTCOMES[intent] || INFO_OUTCOMES.other;
  const formattedOrder = orderFound && orderNumber ? formatOrderNumber(orderNumber) : "";
  const primarySource = knowledge[0] ? describeKnowledgeSource(knowledge[0]).title : "";
  const references = [
    formattedOrder ? `order ${formattedOrder}` : "",
    primarySource ? `“${primarySource}”` : "",
  ].filter(Boolean);

  return {
    label: outcome.label(formattedOrder),
    description: references.length
      ? `Uses ${joinReferences(references)} to ${outcome.goal}.`
      : `${outcome.goal.charAt(0).toUpperCase()}${outcome.goal.slice(1)}.`,
  };
}

function humanize(value) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function languageLabel(value) {
  const code = String(value || "").toLowerCase();
  const labels = { da: "Danish", en: "English", de: "German", no: "Norwegian", sv: "Swedish" };
  return labels[code] || humanize(code);
}

function confidenceMeta(value) {
  const score = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (score == null) return { label: "Confidence not recorded", tone: "neutral" };
  const percentage = Math.round(score * 100);
  if (score >= 0.85) return { label: `High confidence · ${percentage}%`, tone: "positive" };
  if (score >= 0.65) return { label: `Medium confidence · ${percentage}%`, tone: "neutral" };
  return { label: `Low confidence · ${percentage}%`, tone: "warning" };
}

function caseMatchLabel(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Previous case";
  if (score >= 0.8) return "Close match";
  if (score >= 0.65) return "Related case";
  return "Loose match";
}

function StatusBadge({ children, tone = "neutral", variant = "outline" }) {
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        "gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium shadow-none",
        variant === "outline" && "border-border/80 bg-background/80 text-muted-foreground",
        tone === "accent" && "border-violet-200 bg-violet-50 text-violet-700",
        tone === "positive" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {children}
    </span>
  );
}

function EvidenceItem({ icon: Icon, title, typeLabel, preview, badge, children }) {
  return (
    <Collapsible className="group overflow-hidden rounded-xl border border-border/80 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[border-color,background-color,box-shadow] duration-150 ease-out data-[state=open]:border-violet-200 data-[state=open]:bg-violet-50/20 data-[state=open]:shadow-[0_8px_24px_rgba(91,33,182,0.06)]">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start whitespace-normal rounded-xl px-3.5 py-3.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/40 active:scale-[0.995]"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/30 text-muted-foreground transition-colors group-data-[state=open]:border-violet-200 group-data-[state=open]:bg-violet-100/70 group-data-[state=open]:text-violet-700">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              {typeLabel}
            </span>
            <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
            {preview ? (
              <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                {preview}
              </span>
            ) : null}
          </span>
          <StatusBadge tone={badge === "Primary source" ? "accent" : "neutral"}>{badge}</StatusBadge>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Separator />
        <div className="flex flex-col gap-3 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TimelineStep({ icon: Icon, title, description, last = false, children }) {
  return (
    <div className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-3.5">
      {!last ? <span className="absolute bottom-[-24px] left-[19px] top-10 w-px bg-gradient-to-b from-violet-200 via-border to-border" /> : null}
      <span className="relative z-10 flex size-10 items-center justify-center rounded-xl border border-violet-200/80 bg-violet-50 text-violet-700 shadow-[0_1px_2px_rgba(91,33,182,0.08)]">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-3.5 pb-6">
        <div className="flex flex-col gap-0.5 pt-0.5">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
          <p className="max-w-[60ch] text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddToKbForm({ gap, shopId, onSaved, onCancel }) {
  const [title, setTitle] = useState(gap.suggested_title ?? "");
  const [content, setContent] = useState(gap.suggested_content_hint ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), shop_id: shopId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <Input
        className="h-8 text-xs"
        placeholder="Title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(null);
        }}
      />
      <Textarea
        className="min-h-20 resize-none text-xs"
        placeholder="Describe the policy or procedure…"
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setError(null);
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || !title.trim() || !content.trim()}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save to knowledge base"}
        </Button>
      </div>
    </div>
  );
}

export function SonaActivityContent({ diagnostic, shopId }) {
  const [addingGapId, setAddingGapId] = useState(null);
  const [savedGapIds, setSavedGapIds] = useState(new Set());

  if (!diagnostic) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity recorded for this conversation.
      </p>
    );
  }

  const {
    reasoning,
    intent,
    confidence,
    language,
    orderNumber,
    orderFound,
    factsCount = 0,
    kb_chunks = [],
    ticket_examples = [],
    knowledge_gaps = [],
    decision = {},
  } = diagnostic;
  const hasContent = reasoning || intent || kb_chunks.length || ticket_examples.length || knowledge_gaps.length;

  if (!hasContent) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity recorded for this conversation.
      </p>
    );
  }

  const confidenceInfo = confidenceMeta(confidence);
  const intentLabel = INTENT_LABELS[intent] || humanize(intent) || "Customer request";
  const outcomeMeta = replyOutcomeMeta({
    intent,
    resolutionStage: decision.resolutionStage,
    orderNumber,
    orderFound,
    knowledge: kb_chunks,
  });
  const routingLabel = ROUTING_LABELS[decision.routingHint] || "Draft created";
  const needsReview = decision.routingHint === "review" || decision.routingHint === "block";
  const sourcesCount = kb_chunks.length + ticket_examples.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col px-0.5">
        <TimelineStep
          icon={Brain}
          title="1. Understood the request"
          description="Sona classified the customer’s message before deciding what the reply needed to do."
        >
          <div className="flex flex-wrap gap-2">
            <StatusBadge>{intentLabel}</StatusBadge>
            {language ? <StatusBadge>{languageLabel(language)}</StatusBadge> : null}
            {typeof confidence === "number" && Number.isFinite(confidence) ? (
              <StatusBadge tone={confidenceInfo.tone}>{confidenceInfo.label}</StatusBadge>
            ) : null}
          </div>
        </TimelineStep>

        <TimelineStep
          icon={PackageSearch}
          title="2. Checked customer context"
          description="Sona looked for order and customer facts that could make the reply specific."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border/80 bg-muted/20 px-3.5 py-3">
              <p className="text-[11px] font-medium text-muted-foreground">Order context</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {orderFound ? `Order ${orderNumber ? formatOrderNumber(orderNumber) : "found"}` : "No order added"}
              </p>
            </div>
            <div className="rounded-xl border border-border/80 bg-muted/20 px-3.5 py-3">
              <p className="text-[11px] font-medium text-muted-foreground">Context used</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {factsCount} verified fact{factsCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </TimelineStep>

        <TimelineStep
          icon={BookOpen}
          title="3. Used supporting knowledge"
          description="Sona reviewed knowledge and earlier cases before writing. Expand a source to see what informed the reply."
        >
          {sourcesCount > 0 ? (
            <div className="flex flex-col gap-2">
              {kb_chunks.map((chunk, index) => {
                const source = describeKnowledgeSource(chunk);
                const content = describeKnowledgeContent(chunk.content);
                return (
                  <EvidenceItem
                    key={chunk.id ?? index}
                    icon={FileText}
                    title={source.title}
                    typeLabel={source.typeLabel}
                    preview={content.preview.slice(0, 90)}
                    badge={index === 0 ? "Primary source" : "Supporting source"}
                  >
                    {content.question ? (
                      <div className="flex flex-col gap-1">
                        <p className="font-semibold text-foreground">Matched question</p>
                        <p className="whitespace-pre-wrap">{content.question}</p>
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <p className="font-semibold text-foreground">{content.answer ? "Knowledge used" : "Excerpt used"}</p>
                      <p className="whitespace-pre-wrap text-foreground/80">
                        {content.answer || content.body || "No excerpt recorded."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {chunk.usable_as ? <StatusBadge>{humanize(chunk.usable_as)}</StatusBadge> : null}
                    </div>
                  </EvidenceItem>
                );
              })}
              {ticket_examples.map((ticket, index) => (
                <EvidenceItem
                  key={`${ticket.subject || "case"}-${index}`}
                  icon={History}
                  title={ticket.subject || `Previous case ${index + 1}`}
                  typeLabel="Previous case"
                  preview={(ticket.customer_msg || "").slice(0, 90)}
                  badge={caseMatchLabel(ticket.score)}
                >
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-foreground">Customer asked</p>
                    <p className="whitespace-pre-wrap">{ticket.customer_msg || "No customer message recorded."}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-foreground">Previous reply</p>
                    <p className="whitespace-pre-wrap">{ticket.agent_reply || "No previous reply recorded."}</p>
                  </div>
                </EvidenceItem>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              No support sources or previous cases were recorded for this draft.
            </div>
          )}
        </TimelineStep>

        <TimelineStep
          icon={Send}
          title="4. Created the draft"
          description="Sona combined the request, customer context, and supporting knowledge into a reply."
          last
        >
          <div className="flex max-w-[66ch] flex-col gap-4">
            {needsReview ? (
              <div className="flex items-center gap-2 text-xs font-medium text-amber-700">
                <CircleAlert className="size-3.5" />
                {routingLabel}
              </div>
            ) : null}

            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Draft outcome</p>
              <p className="mt-1 text-[15px] font-semibold text-foreground">{outcomeMeta.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{outcomeMeta.description}</p>
            </div>

            {decision.requiredFacts?.length ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
                <span className="text-[11px] font-medium text-muted-foreground">Included in the reply</span>
                {decision.requiredFacts.map((fact) => <StatusBadge key={fact}>{humanize(fact)}</StatusBadge>)}
              </div>
            ) : null}
          </div>
        </TimelineStep>
      </div>

      {knowledge_gaps.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CircleAlert className="size-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-foreground">Knowledge Sona was missing</h3>
            <StatusBadge tone="warning">{knowledge_gaps.length}</StatusBadge>
          </div>
          <div className="flex flex-col gap-2">
            {knowledge_gaps.map((gap, index) => {
              const gapId = `${gap.gap_type}-${index}`;
              const isSaved = savedGapIds.has(gapId);
              const isAdding = addingGapId === gapId;
              const isLiveDataGap = gap.gap_type === "missing_live_data";
              return (
                <div key={gapId} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-sm font-medium text-amber-950">{gap.suggested_title || humanize(gap.gap_type)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-900/70">{gap.suggested_content_hint}</p>
                  {isLiveDataGap ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {gap.product ? <StatusBadge tone="warning">{gap.product}</StatusBadge> : null}
                      {gap.source ? <StatusBadge>{humanize(gap.source)}</StatusBadge> : null}
                      {gap.reason ? <StatusBadge>{humanize(gap.reason)}</StatusBadge> : null}
                      <Button asChild type="button" size="sm" variant="outline" className="ml-auto">
                        <Link href="/integrations">Review inventory source</Link>
                      </Button>
                    </div>
                  ) : isSaved ? (
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <Check className="size-3.5" /> Saved to knowledge base
                    </p>
                  ) : isAdding ? (
                    <AddToKbForm
                      gap={gap}
                      shopId={shopId}
                      onSaved={() => {
                        setSavedGapIds((previous) => new Set([...previous, gapId]));
                        setAddingGapId(null);
                      }}
                      onCancel={() => setAddingGapId(null)}
                    />
                  ) : (
                    <Button type="button" size="sm" className="mt-3" onClick={() => setAddingGapId(gapId)}>
                      <Plus className="size-3.5" /> Add to knowledge base
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
