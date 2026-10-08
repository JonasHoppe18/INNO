"use client";

import {
  DEFAULT_SIGNATURE_BUILDER,
  SIGNATURE_TEXT_FIELD_KEYS,
  buildSignatureTemplateFromBuilder,
  parseSignatureBuilderFromTemplate,
} from "@/components/settings/sections/email/signature-builder";
import { normalizeSenderRuleDestinationType, normalizeSenderRuleDestinationValue } from "@/lib/settings/email-rows";
import { EMAIL_SECTIONS } from "@/lib/settings/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { uploadEmailSignatureImage } from "@/lib/email-signature-image";
import { cn } from "@/lib/utils";
import { PenLine, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
export function EmailSettings({
  activeSection = "auto-reply",
  onSectionChange,
  enabled,
  onEnabledChange,
  subjectTemplate,
  onSubjectTemplateChange,
  bodyTextTemplate,
  onBodyTextTemplateChange,
  bodyHtmlTemplate = "",
  onBodyHtmlTemplateChange,
  confirmationTemplateHtml = "",
  includeTicketNumber = true,
  onIncludeTicketNumberChange,
  confirmationMailboxes = [],
  selectedConfirmationMailboxId = "",
  onConfirmationMailboxChange,
  inheritsWorkspace = false,
  onInheritsWorkspaceChange,
  currentUserEmail = "",
  signatureIsActive = true,
  onSignatureIsActiveChange,
  signatureTemplateHtml = "",
  onSignatureTemplateHtmlChange,
  onSendSignatureTest,
  sendingSignatureTest = false,
  routingRows = [],
  onUpdateRoutingRow,
  onAddRoutingCategory,
  onDeleteRoutingCategory,
  senderRuleRows = [],
  senderRuleInboxes = [],
  onUpdateSenderRuleRow,
  onAddSenderRule,
  onDeleteSenderRule,
  blocklistRows = [],
  onUpdateBlocklistRow,
  onAddBlocklistRow,
  onDeleteBlocklistRow,
  canSave = false,
  onSaveChanges,
  onDiscardChanges,
  savingRouting = false,
  saving,
}) {
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [draftSubject, setDraftSubject] = useState(subjectTemplate || "");
  const [draftBody, setDraftBody] = useState(bodyTextTemplate || "");
  const [addCategoryModalOpen, setAddCategoryModalOpen] = useState(false);
  const [addSenderRuleModalOpen, setAddSenderRuleModalOpen] = useState(false);
  const [addBlocklistModalOpen, setAddBlocklistModalOpen] = useState(false);
  const [newSenderMatcherType, setNewSenderMatcherType] = useState("email");
  const [newSenderMatcherValue, setNewSenderMatcherValue] = useState("");
  const [newSenderDestination, setNewSenderDestination] = useState("classification:notification");
  const [newBlockMatcherType, setNewBlockMatcherType] = useState("email");
  const [newBlockMatcherValue, setNewBlockMatcherValue] = useState("");
  const [newBlockNote, setNewBlockNote] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [signatureBuilderOpen, setSignatureBuilderOpen] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState(DEFAULT_SIGNATURE_BUILDER);
  const [signatureLogoUploadError, setSignatureLogoUploadError] = useState("");
  const [testConfirmationOpen, setTestConfirmationOpen] = useState(false);
  const [testConfirmationEmail, setTestConfirmationEmail] = useState(currentUserEmail || "");
  const [sendingConfirmationTest, setSendingConfirmationTest] = useState(false);

  useEffect(() => {
    setDraftSubject(subjectTemplate || "");
  }, [subjectTemplate]);

  useEffect(() => {
    setDraftBody(bodyTextTemplate || "");
  }, [bodyTextTemplate]);

  useEffect(() => {
    if (testConfirmationOpen && !testConfirmationEmail) {
      setTestConfirmationEmail(currentUserEmail || "");
    }
  }, [currentUserEmail, testConfirmationEmail, testConfirmationOpen]);

  const handleSendConfirmationTest = useCallback(async () => {
    if (sendingConfirmationTest) return;
    setSendingConfirmationTest(true);
    try {
      const response = await fetch("/api/settings/auto-reply/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipient: testConfirmationEmail,
          mailbox_id: selectedConfirmationMailboxId || null,
          include_ticket_number: includeTicketNumber,
          subject_template: subjectTemplate,
          body_text_template: bodyTextTemplate,
          body_html_template: bodyHtmlTemplate,
          template_html: confirmationTemplateHtml,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not send test confirmation.");
      toast.success(`Test confirmation sent to ${testConfirmationEmail}.`);
      setTestConfirmationOpen(false);
    } catch (error) {
      toast.error(error?.message || "Could not send test confirmation.");
    } finally {
      setSendingConfirmationTest(false);
    }
  }, [
    bodyTextTemplate,
    bodyHtmlTemplate,
    confirmationTemplateHtml,
    includeTicketNumber,
    selectedConfirmationMailboxId,
    sendingConfirmationTest,
    subjectTemplate,
    testConfirmationEmail,
  ]);

  const handleToggleEnabled = useCallback(
    (nextValue) => {
      onEnabledChange(nextValue);
    },
    [onEnabledChange]
  );

  const handleSaveMessage = useCallback(() => {
    onSubjectTemplateChange(draftSubject);
    onBodyTextTemplateChange(draftBody);
    onBodyHtmlTemplateChange?.("");
    setMessageModalOpen(false);
  }, [draftBody, draftSubject, onBodyHtmlTemplateChange, onBodyTextTemplateChange, onSubjectTemplateChange]);

  const handleCreateCategory = useCallback(() => {
    const label = String(newCategoryLabel || "").trim();
    if (!label) return;
    onAddRoutingCategory?.(label);
    setNewCategoryLabel("");
    setAddCategoryModalOpen(false);
  }, [newCategoryLabel, onAddRoutingCategory]);

  const senderDestinationOptions = useMemo(() => {
    const dynamicOptions = (routingRows || []).map((row) => ({
      value: `classification:${String(row?.category_key || "").trim().toLowerCase()}`,
      label: String(row?.label || row?.category_key || "").trim() || "Custom",
    }));
    const inboxOptions = (senderRuleInboxes || []).map((inbox) => {
      const slug = String(inbox?.slug || "").trim().toLowerCase();
      const name = String(inbox?.name || slug || "").trim();
      return {
        value: `inbox:${slug}`,
        label: name ? `${name} (Inbox)` : `${slug} (Inbox)`,
      };
    });
    const seen = new Set();
    const merged = [
      { value: "classification:notification", label: "Notifications" },
      { value: "classification:support", label: "Support" },
      ...dynamicOptions,
      ...inboxOptions,
    ].filter((option) => {
      const value = String(option?.value || "").trim();
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
    return merged;
  }, [routingRows, senderRuleInboxes]);

  const handleCreateSenderRule = useCallback(() => {
    const matcherType = String(newSenderMatcherType || "email").trim().toLowerCase() === "domain" ? "domain" : "email";
    const matcherValue = String(newSenderMatcherValue || "").trim().toLowerCase();
    const destinationToken = String(newSenderDestination || "").trim().toLowerCase();
    if (!matcherValue || !destinationToken) return;
    const [destinationTypeRaw, destinationValueRaw] = destinationToken.split(":", 2);
    const destinationType =
      destinationTypeRaw === "inbox" ? "inbox" : "classification";
    const destinationValue =
      destinationType === "inbox"
        ? normalizeSenderRuleDestinationValue("inbox", destinationValueRaw)
        : normalizeSenderRuleDestinationValue("classification", destinationValueRaw);
    if (!destinationValue) return;
    onAddSenderRule?.({
      matcher_type: matcherType,
      matcher_value: matcherValue,
      destination_type: destinationType,
      destination_value: destinationValue,
    });
    setNewSenderMatcherType("email");
    setNewSenderMatcherValue("");
    setNewSenderDestination("classification:notification");
    setAddSenderRuleModalOpen(false);
  }, [
    newSenderDestination,
    newSenderMatcherType,
    newSenderMatcherValue,
    onAddSenderRule,
  ]);

  const handleCreateBlocklistRow = useCallback(() => {
    const matcherType = String(newBlockMatcherType || "email").trim().toLowerCase() === "domain" ? "domain" : "email";
    const matcherValue = String(newBlockMatcherValue || "").trim().toLowerCase();
    if (!matcherValue) return;
    onAddBlocklistRow?.({
      matcher_type: matcherType,
      matcher_value: matcherValue,
      note: String(newBlockNote || "").trim(),
    });
    setNewBlockMatcherType("email");
    setNewBlockMatcherValue("");
    setNewBlockNote("");
    setAddBlocklistModalOpen(false);
  }, [
    newBlockMatcherType,
    newBlockMatcherValue,
    newBlockNote,
    onAddBlocklistRow,
  ]);

  const handleSignatureDraftField = useCallback((field, value) => {
    setSignatureDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSignatureFieldVisibility = useCallback((fieldKey, nextVisible) => {
    if (!SIGNATURE_TEXT_FIELD_KEYS.includes(fieldKey)) return;
    setSignatureDraft((prev) => ({
      ...prev,
      fieldVisibility: {
        ...(prev?.fieldVisibility || {}),
        [fieldKey]: Boolean(nextVisible),
      },
    }));
  }, []);

  const handleSignatureFieldMove = useCallback((fieldKey, direction) => {
    if (!SIGNATURE_TEXT_FIELD_KEYS.includes(fieldKey)) return;
    setSignatureDraft((prev) => {
      const order = Array.isArray(prev?.textOrder) ? [...prev.textOrder] : [...SIGNATURE_TEXT_FIELD_KEYS];
      const index = order.indexOf(fieldKey);
      if (index < 0) return prev;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= order.length) return prev;
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return {
        ...prev,
        textOrder: order,
      };
    });
  }, []);

  const handleLogoUpload = useCallback(async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(String(file.type || "").toLowerCase())) {
      setSignatureLogoUploadError("Please upload a PNG or JPEG image.");
      return;
    }
    if (Number(file.size || 0) > 5 * 1024 * 1024) {
      setSignatureLogoUploadError("Logo must be 5 MB or smaller.");
      return;
    }
    try {
      setSignatureLogoUploadError("Uploading logo…");
      const result = await uploadEmailSignatureImage(file);
      setSignatureLogoUploadError("");
      setSignatureDraft((prev) => ({ ...prev, logoUrl: result }));
    } catch (error) {
      setSignatureLogoUploadError(error?.message || "Could not upload logo file.");
    }
  }, []);

  const handleApplySignatureBuilder = useCallback(() => {
    onSignatureTemplateHtmlChange?.(buildSignatureTemplateFromBuilder(signatureDraft));
    setSignatureBuilderOpen(false);
  }, [onSignatureTemplateHtmlChange, signatureDraft]);

  const handleClearSignatureTemplate = useCallback(() => {
    if (!window.confirm("Clear outbound signature template?")) return;
    onSignatureTemplateHtmlChange?.("");
  }, [onSignatureTemplateHtmlChange]);

  const previewLines = String(bodyTextTemplate || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const confirmationControlsDisabled = Boolean(
    saving || (selectedConfirmationMailboxId && inheritsWorkspace)
  );
  const previewSubject = `${includeTicketNumber ? "[T-50001] " : ""}${
    subjectTemplate || "We've received your message"
  }`;

  const signaturePreviewHtml = useMemo(() => {
    const sampleReply = "Message body preview.";
    const templateHtml = String(signatureTemplateHtml || "").trim();
    const templateSection = templateHtml || "";
    return [sampleReply.replace(/\n/g, "<br/>"), templateSection]
      .filter(Boolean)
      .join("<br/><br/>");
  }, [signatureTemplateHtml]);

  const signatureSummary = useMemo(() => {
    const parsed = parseSignatureBuilderFromTemplate(signatureTemplateHtml);
    const hasAnyTemplate = Boolean(String(signatureTemplateHtml || "").trim());
    const lineOne =
      String(parsed.fullName || "").trim() ||
      (hasAnyTemplate ? "Signature template configured." : "No signature configured yet.");
    const lineTwo = String(parsed.jobTitle || "").trim();
    return [lineOne, lineTwo].filter(Boolean).join(" • ");
  }, [signatureTemplateHtml]);

  const signatureDraftPreviewHtml = useMemo(
    () => buildSignatureTemplateFromBuilder(signatureDraft),
    [signatureDraft]
  );

  useEffect(() => {
    if (!signatureBuilderOpen) return;
    setSignatureDraft(parseSignatureBuilderFromTemplate(signatureTemplateHtml));
    setSignatureLogoUploadError("");
  }, [signatureBuilderOpen, signatureTemplateHtml]);

  return (
    <section className="w-full space-y-5">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-page-heading font-semibold tracking-tight text-foreground">Email</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure customer-facing messages, routing and sender controls.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-border" aria-label="Email settings sections">
        <div className="flex min-w-max gap-1">
          {EMAIL_SECTIONS.map((section) => {
            const active = activeSection === section.key;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => onSectionChange?.(section.key)}
                className={cn(
                  "relative px-3 py-2.5 text-sm font-medium transition-colors duration-150 active:scale-[0.98]",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {section.label}
                {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {confirmationMailboxes.length > 1 ? (
          <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "auto-reply" && "hidden")}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr] md:items-start">
            <div>
              <h3 className="font-medium text-foreground">Configuration scope</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Set the workspace default or override it for one mailbox.
              </p>
            </div>
            <div className="space-y-3">
              <Select
                value={selectedConfirmationMailboxId || "workspace"}
                onValueChange={(value) => onConfirmationMailboxChange?.(value === "workspace" ? "" : value)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose configuration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">Workspace default</SelectItem>
                  {confirmationMailboxes.map((mailbox) => (
                    <SelectItem key={mailbox.id} value={mailbox.id}>
                      {mailbox.from_name || mailbox.from_email || mailbox.provider_email || "Mailbox"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedConfirmationMailboxId ? (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border"
                    checked={inheritsWorkspace}
                    onChange={(event) => onInheritsWorkspaceChange?.(event.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Use workspace default</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Remove this mailbox override and inherit future workspace changes.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          </div>
          </div>
        ) : null}

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "auto-reply" && "hidden")}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr] md:items-center">
            <div>
              <h3 className="font-medium text-foreground">Send confirmation email</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Send once when a customer creates a new support ticket. Follow-up messages never trigger it.
              </p>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => handleToggleEnabled(!enabled)}
                disabled={confirmationControlsDisabled}
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
                  enabled ? "bg-success-foreground" : "bg-muted",
                  confirmationControlsDisabled && "cursor-not-allowed opacity-70"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                    enabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "auto-reply" && "hidden")}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr] md:items-center">
            <div>
              <h3 className="font-medium text-foreground">Include ticket reference</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add the system-managed reference to the subject and email footer.
              </p>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                role="switch"
                aria-checked={includeTicketNumber}
                onClick={() => onIncludeTicketNumberChange?.(!includeTicketNumber)}
                disabled={confirmationControlsDisabled}
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
                  includeTicketNumber ? "bg-success-foreground" : "bg-muted",
                  confirmationControlsDisabled && "cursor-not-allowed opacity-70"
                )}
              >
                <span className={cn(
                  "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                  includeTicketNumber ? "translate-x-6" : "translate-x-1"
                )} />
              </button>
            </div>
          </div>
        </div>

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "auto-reply" && "hidden")}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr]">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground">Confirmation message</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The ticket reference is inserted by Sona and cannot be removed from this text.
              </p>
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border border-border bg-card"
                  onClick={() => setMessageModalOpen(true)}
                  disabled={confirmationControlsDisabled}
                >
                  <PenLine className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/settings/confirmation/email${selectedConfirmationMailboxId ? `?mailbox_id=${encodeURIComponent(selectedConfirmationMailboxId)}` : ""}`}>Customize email design</Link>
                </Button>
              </div>
              <div className="min-w-0 rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground">Preview</p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {previewSubject}
                </p>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {previewLines.length ? (
                    previewLines.map((line, index) => (
                      <p key={`${line}-${index}`} className="break-words">
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="text-muted-foreground">No message set yet.</p>
                  )}
                </div>
                {includeTicketNumber ? (
                  <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    Ticket reference: T-50001
                  </p>
                ) : null}
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => setTestConfirmationOpen(true)}>
                    Send test email
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "routing" && "hidden")}>
          <div className="space-y-5">
            <div className="max-w-3xl">
              <h3 className="font-medium text-foreground">Email Routing</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Automatically detect non-support emails and route them to the right team.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Emails that don&apos;t match an active category stay in your Sona inbox.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Support emails are always handled in Sona.</p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingRouting}
                  onClick={() => setAddCategoryModalOpen(true)}
                >
                  + Add email category
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <div>
                  <div className="grid grid-cols-[1.1fr_2fr_1.2fr_90px_44px] items-center gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Category</span>
                    <span>Forward to</span>
                    <span>Mode</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>
                  {routingRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1.1fr_2fr_1.2fr_90px_44px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                    >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{row.label}</span>
                    </div>
                    <Input
                      type="email"
                      placeholder="forward@company.com"
                      value={row.forward_to_email || ""}
                      onChange={(event) =>
                        onUpdateRoutingRow?.({
                          ...row,
                          forward_to_email: event.target.value,
                        })
                      }
                      className="h-9 w-full border-transparent bg-transparent text-input md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={savingRouting}
                    />
                    <Select
                      value={row.mode || "manual_approval"}
                      onValueChange={(value) =>
                        onUpdateRoutingRow?.({
                          ...row,
                          mode: value,
                        })
                      }
                      disabled={savingRouting}
                    >
                      <SelectTrigger className="h-9 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
                        <SelectValue placeholder="Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual_approval">Manual approval</SelectItem>
                        <SelectItem value="auto_forward">Auto forward</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(row.is_active)}
                        onClick={() =>
                          onUpdateRoutingRow?.({
                            ...row,
                            is_active: !Boolean(row.is_active),
                          })
                        }
                        disabled={savingRouting}
                        className={cn(
                          "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
                          row.is_active ? "bg-success-foreground" : "bg-muted",
                          savingRouting && "cursor-not-allowed opacity-70"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                            row.is_active ? "translate-x-6" : "translate-x-1"
                          )}
                        />
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-danger-foreground"
                      disabled={savingRouting}
                      onClick={() => onDeleteRoutingCategory?.(row)}
                      title="Delete category"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                If a category is inactive, deleted, or has no forwarding email, messages remain in the normal inbox.
              </p>
            </div>
          </div>
        </div>

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "sender-rules" && "hidden")}>
          <div className="space-y-5">
            <div className="max-w-3xl">
              <h3 className="font-medium text-foreground">Sender Rules</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Route new inbound emails by exact sender email or sender domain.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Exact email rules take precedence over domain rules. Only new incoming emails are affected.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingRouting}
                  onClick={() => setAddSenderRuleModalOpen(true)}
                >
                  + Add sender rule
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <div>
                  <div className="grid grid-cols-[1fr_1.6fr_1fr_90px_44px] items-center gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Type</span>
                    <span>Sender match</span>
                    <span>Destination</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>
                  {senderRuleRows.map((row) => (
                    (() => {
                      const destinationType = normalizeSenderRuleDestinationType(row.destination_type);
                      const destinationValueNormalized = normalizeSenderRuleDestinationValue(
                        destinationType,
                        row.destination_value
                      );
                      const destinationToken = `${destinationType}:${destinationValueNormalized}`;
                      const hasDestination = senderDestinationOptions.some(
                        (option) => String(option?.value || "").trim().toLowerCase() === destinationToken
                      );
                      const destinationOptions = hasDestination
                        ? senderDestinationOptions
                        : [
                            {
                              value: destinationToken,
                              label:
                                destinationType === "inbox"
                                  ? `${destinationValueNormalized} (Inbox, deleted)`
                                  : `${destinationValueNormalized} (inactive)`,
                            },
                            ...senderDestinationOptions,
                          ];
                      return (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_1.6fr_1fr_90px_44px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <Select
                        value={row.matcher_type || "email"}
                        onValueChange={(value) =>
                          onUpdateSenderRuleRow?.({
                            ...row,
                            matcher_type: value === "domain" ? "domain" : "email",
                          })
                        }
                        disabled={savingRouting}
                      >
                        <SelectTrigger className="h-9 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="domain">Domain</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        placeholder={row.matcher_type === "domain" ? "example.com" : "sender@example.com"}
                        value={row.matcher_value || ""}
                        onChange={(event) =>
                          onUpdateSenderRuleRow?.({
                            ...row,
                            matcher_value: event.target.value,
                          })
                        }
                        className="h-9 w-full border-transparent bg-transparent text-input md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={savingRouting}
                      />
                      <Select
                        value={destinationToken || "classification:notification"}
                        onValueChange={(value) =>
                          {
                            const [nextTypeRaw, nextValueRaw] = String(value || "").split(":", 2);
                            const nextType =
                              nextTypeRaw === "inbox" ? "inbox" : "classification";
                            const nextValue = normalizeSenderRuleDestinationValue(
                              nextType,
                              nextValueRaw
                            );
                            onUpdateSenderRuleRow?.({
                              ...row,
                              destination_type: nextType,
                              destination_value: nextValue,
                            });
                          }
                        }
                        disabled={savingRouting}
                      >
                        <SelectTrigger className="h-9 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
                          <SelectValue placeholder="Destination" />
                        </SelectTrigger>
                        <SelectContent>
                          {destinationOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(row.is_active)}
                          onClick={() =>
                            onUpdateSenderRuleRow?.({
                              ...row,
                              is_active: !Boolean(row.is_active),
                            })
                          }
                          disabled={savingRouting}
                          className={cn(
                            "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
                            row.is_active ? "bg-success-foreground" : "bg-muted",
                            savingRouting && "cursor-not-allowed opacity-70"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                              row.is_active ? "translate-x-6" : "translate-x-1"
                            )}
                          />
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-danger-foreground"
                        disabled={savingRouting}
                        onClick={() => onDeleteSenderRule?.(row)}
                        title="Delete sender rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                      );
                    })()
                  ))}
                  {!senderRuleRows.length ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      No sender rules yet.
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                A sender rule override applies before AI/heuristic classification.
              </p>
            </div>
          </div>
        </div>

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "blocklist" && "hidden")}>
          <div className="space-y-5">
            <div className="max-w-3xl">
              <h3 className="font-medium text-foreground">Blocked Senders</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Soft-block future inbound emails by exact sender email or domain.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Blocked emails are stored for audit but hidden from the normal inbox.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingRouting}
                  onClick={() => setAddBlocklistModalOpen(true)}
                >
                  + Add blocked sender
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <div>
                  <div className="grid grid-cols-[1fr_1.6fr_1.2fr_90px_44px] items-center gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Type</span>
                    <span>Sender match</span>
                    <span>Note</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>
                  {blocklistRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_1.6fr_1.2fr_90px_44px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <Select
                        value={row.matcher_type || "email"}
                        onValueChange={(value) =>
                          onUpdateBlocklistRow?.({
                            ...row,
                            matcher_type: value === "domain" ? "domain" : "email",
                          })
                        }
                        disabled={savingRouting}
                      >
                        <SelectTrigger className="h-9 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="domain">Domain</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        placeholder={row.matcher_type === "domain" ? "example.com" : "sender@example.com"}
                        value={row.matcher_value || ""}
                        onChange={(event) =>
                          onUpdateBlocklistRow?.({
                            ...row,
                            matcher_value: event.target.value,
                          })
                        }
                        className="h-9 w-full border-transparent bg-transparent text-input md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={savingRouting}
                      />
                      <Input
                        type="text"
                        placeholder="Optional"
                        value={row.note || ""}
                        onChange={(event) =>
                          onUpdateBlocklistRow?.({
                            ...row,
                            note: event.target.value,
                          })
                        }
                        className="h-9 w-full border-transparent bg-transparent text-input md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={savingRouting}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(row.is_active)}
                          onClick={() =>
                            onUpdateBlocklistRow?.({
                              ...row,
                              is_active: !Boolean(row.is_active),
                            })
                          }
                          disabled={savingRouting}
                          className={cn(
                            "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
                            row.is_active ? "bg-success-foreground" : "bg-muted",
                            savingRouting && "cursor-not-allowed opacity-70"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                              row.is_active ? "translate-x-6" : "translate-x-1"
                            )}
                          />
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-danger-foreground"
                        disabled={savingRouting}
                        onClick={() => onDeleteBlocklistRow?.(row)}
                        title="Delete blocked sender"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {!blocklistRows.length ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      No blocked senders yet.
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Exact email blocks take precedence over domain blocks and sender rules.
              </p>
            </div>
          </div>
        </div>

        <div className={cn("rounded-2xl border border-border bg-card p-6", activeSection !== "signatures" && "hidden")}>
          <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <h3 className="font-medium text-foreground">Outbound signature</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add a consistent workspace signature below outgoing replies.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(signatureIsActive)}
                onClick={() => onSignatureIsActiveChange?.(!signatureIsActive)}
                disabled={saving}
                className={cn(
                  "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-150",
                  signatureIsActive ? "bg-primary" : "bg-muted-foreground/25",
                  saving && "cursor-not-allowed opacity-60"
                )}
              >
                <span className={cn("inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-150", signatureIsActive ? "translate-x-6" : "translate-x-1")} />
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current signature</p>
                <p className="mt-2 text-sm text-foreground">{signatureSummary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSignatureBuilderOpen(true)}>
                    <PenLine className="mr-1.5 h-3.5 w-3.5" />
                    Edit signature
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={onSendSignatureTest} disabled={sendingSignatureTest || !String(signatureTemplateHtml || "").trim()}>
                    {sendingSignatureTest ? "Sending…" : "Send test"}
                  </Button>
                  {String(signatureTemplateHtml || "").trim() ? (
                    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger-foreground" onClick={handleClearSignatureTemplate}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Preview</div>
                <div className="min-h-28 p-4 text-sm text-foreground" dangerouslySetInnerHTML={{ __html: signaturePreviewHtml }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={signatureBuilderOpen} onOpenChange={setSignatureBuilderOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit outbound signature</DialogTitle>
            <DialogDescription>Choose the details shown below workspace replies.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["fullName", "Full name", "Alex Morgan"],
                ["jobTitle", "Job title", "Customer Support"],
                ["phone", "Phone", "+45 12 34 56 78"],
                ["email", "Email", "support@example.com"],
                ["companyName", "Company", "Company name"],
              ].map(([field, label, placeholder]) => (
                <label key={field} className={cn("space-y-1.5", field === "logoUrl" && "sm:col-span-2")}>
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <Input value={signatureDraft[field] || ""} onChange={(event) => handleSignatureDraftField(field, event.target.value)} placeholder={placeholder} />
                </label>
              ))}
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-foreground">Logo</span>
                <Input type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} />
                <span className="block text-xs text-muted-foreground">PNG or JPG up to 5 MB.</span>
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-foreground">Accent color</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={signatureDraft.accentColor || "#6d5dfc"} onChange={(event) => handleSignatureDraftField("accentColor", event.target.value)} className="h-9 w-12 rounded-md border border-input bg-background p-1" />
                  <Input value={signatureDraft.accentColor || ""} onChange={(event) => handleSignatureDraftField("accentColor", event.target.value)} placeholder="#6d5dfc" />
                </div>
              </label>
              {signatureLogoUploadError ? <p className="text-sm text-danger-foreground sm:col-span-2">{signatureLogoUploadError}</p> : null}
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Preview</div>
              <div className="min-h-44 p-4 text-sm" dangerouslySetInnerHTML={{ __html: signatureDraftPreviewHtml }} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSignatureBuilderOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleApplySignatureBuilder}>Apply signature</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageModalOpen} onOpenChange={setMessageModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Customer confirmation message
            </DialogTitle>
            <DialogDescription>
              This message is sent once when a customer creates a new support ticket.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Subject</label>
              <Input
                value={draftSubject}
                onChange={(event) => setDraftSubject(event.target.value)}
                placeholder="We've received your message"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Message</label>
                <span className="text-xs text-muted-foreground">
                  {draftBody.length} / 2000 characters
                </span>
              </div>
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value.slice(0, 2000))}
                rows={8}
                className="w-full rounded-md border border-border px-3 py-2 text-input md:text-sm"
              />
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Email Preview</h4>
              <div className="rounded-md border border-border">
                <div className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
                  <div>From: [sender]</div>
                  <div>To: [recipient]</div>
                  <div>
                    Subject: {includeTicketNumber ? "[T-50001] " : ""}
                    {draftSubject || "We've received your message"}
                  </div>
                </div>
                <div
                  className="p-4 text-sm text-foreground"
                  dangerouslySetInnerHTML={{
                    __html: `<div style="white-space:pre-wrap;">${String(draftBody || "")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")}</div>`,
                  }}
                />
                {includeTicketNumber ? (
                  <div className="px-4 pb-4 text-xs text-muted-foreground">Ticket reference: T-50001</div>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMessageModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveMessage} disabled={saving}>
              {saving ? "Saving..." : "Save message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={testConfirmationOpen} onOpenChange={setTestConfirmationOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send test confirmation</DialogTitle>
            <DialogDescription>
              Send the current preview without creating a ticket or conversation event.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Recipient email</span>
            <Input
              type="email"
              value={testConfirmationEmail}
              onChange={(event) => setTestConfirmationEmail(event.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTestConfirmationOpen(false)} disabled={sendingConfirmationTest}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSendConfirmationTest} disabled={sendingConfirmationTest || !testConfirmationEmail.trim()}>
              {sendingConfirmationTest ? "Sending…" : "Send test email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={addCategoryModalOpen}
        onOpenChange={(next) => {
          setAddCategoryModalOpen(next);
          if (!next) setNewCategoryLabel("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add category</DialogTitle>
            <DialogDescription>
              Create a custom inbound routing category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Category name</label>
            <Input
              value={newCategoryLabel}
              onChange={(event) => setNewCategoryLabel(event.target.value)}
              placeholder="e.g. Press"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddCategoryModalOpen(false);
                setNewCategoryLabel("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateCategory}
              disabled={!String(newCategoryLabel || "").trim()}
            >
              Create category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={addSenderRuleModalOpen}
        onOpenChange={(next) => {
            setAddSenderRuleModalOpen(next);
          if (!next) {
            setNewSenderMatcherType("email");
            setNewSenderMatcherValue("");
            setNewSenderDestination("classification:notification");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add sender rule</DialogTitle>
            <DialogDescription>
              Route future emails from a specific sender email or domain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Type</label>
              <Select value={newSenderMatcherType} onValueChange={setNewSenderMatcherType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="domain">Domain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Match value</label>
              <Input
                value={newSenderMatcherValue}
                onChange={(event) => setNewSenderMatcherValue(event.target.value)}
                placeholder={newSenderMatcherType === "domain" ? "example.com" : "sender@example.com"}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Destination</label>
              <Select value={newSenderDestination} onValueChange={setNewSenderDestination}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination" />
                </SelectTrigger>
                <SelectContent>
                  {senderDestinationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddSenderRuleModalOpen(false);
                setNewSenderMatcherType("email");
                setNewSenderMatcherValue("");
                setNewSenderDestination("classification:notification");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateSenderRule}
              disabled={
                !String(newSenderMatcherValue || "").trim() ||
                !String(newSenderDestination || "").trim()
              }
            >
              Create rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={addBlocklistModalOpen}
        onOpenChange={(next) => {
          setAddBlocklistModalOpen(next);
          if (!next) {
            setNewBlockMatcherType("email");
            setNewBlockMatcherValue("");
            setNewBlockNote("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add blocked sender</DialogTitle>
            <DialogDescription>
              Hide future emails from a specific sender email or domain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Type</label>
              <Select value={newBlockMatcherType} onValueChange={setNewBlockMatcherType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="domain">Domain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Match value</label>
              <Input
                value={newBlockMatcherValue}
                onChange={(event) => setNewBlockMatcherValue(event.target.value)}
                placeholder={newBlockMatcherType === "domain" ? "example.com" : "sender@example.com"}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Note</label>
              <Input
                value={newBlockNote}
                onChange={(event) => setNewBlockNote(event.target.value.slice(0, 300))}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddBlocklistModalOpen(false);
                setNewBlockMatcherType("email");
                setNewBlockMatcherValue("");
                setNewBlockNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateBlocklistRow}
              disabled={!String(newBlockMatcherValue || "").trim()}
            >
              Create block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StickySaveBar
        isVisible={canSave}
        isSaving={saving || savingRouting}
        onSave={onSaveChanges}
        onDiscard={onDiscardChanges}
      />
    </section>
  );
}
