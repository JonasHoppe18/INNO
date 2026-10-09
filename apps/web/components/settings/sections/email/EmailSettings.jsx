"use client";

import { normalizeSenderRuleDestinationType, normalizeSenderRuleDestinationValue } from "@/lib/settings/email-rows";
import { EMAIL_SECTIONS } from "@/lib/settings/navigation";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSaveBar,
  SettingsSwitch,
  SettingsTabs,
} from "@/components/settings/ui/settings-layout";
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

  return (
    <SettingsPage title="Email" description="Configure customer-facing messages, routing and sender controls.">
      <SettingsTabs tabs={EMAIL_SECTIONS} value={activeSection} onChange={(key) => onSectionChange?.(key)} />

      <div className={cn(activeSection !== "auto-reply" && "hidden")}>
        <SettingsGroup title="Customer confirmation">
          {confirmationMailboxes.length > 1 ? (
            <SettingsRow label="Configuration scope" description="Set the workspace default or override it for one mailbox.">
              <Select
                value={selectedConfirmationMailboxId || "workspace"}
                onValueChange={(value) => onConfirmationMailboxChange?.(value === "workspace" ? "" : value)}
                disabled={saving}
              >
                <SelectTrigger className="h-8 text-sm" aria-label="Configuration scope">
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
            </SettingsRow>
          ) : null}
          {confirmationMailboxes.length > 1 && selectedConfirmationMailboxId ? (
            <SettingsRow
              label="Use workspace default"
              description="Remove this mailbox override and inherit future workspace changes."
            >
              <SettingsSwitch
                aria-label="Use workspace default"
                checked={Boolean(inheritsWorkspace)}
                onCheckedChange={(checked) => onInheritsWorkspaceChange?.(Boolean(checked))}
                disabled={saving}
              />
            </SettingsRow>
          ) : null}
          <SettingsRow
            label="Send confirmation email"
            description="Send once when a customer creates a new support ticket. Follow-up messages never trigger it."
          >
            <SettingsSwitch
              aria-label="Send confirmation email"
              checked={Boolean(enabled)}
              onCheckedChange={() => handleToggleEnabled(!enabled)}
              disabled={confirmationControlsDisabled}
            />
          </SettingsRow>
          <SettingsRow
            label="Include ticket reference"
            description="Add the system-managed reference to the subject and email footer."
          >
            <SettingsSwitch
              aria-label="Include ticket reference"
              checked={Boolean(includeTicketNumber)}
              onCheckedChange={() => onIncludeTicketNumberChange?.(!includeTicketNumber)}
              disabled={confirmationControlsDisabled}
            />
          </SettingsRow>
          <SettingsRow
            stacked
            label="Confirmation message"
            description="The ticket reference is inserted by Sona and cannot be removed from this text."
          >
            <div className="w-full space-y-3">
              <div className="min-w-0 rounded-lg border border-border/70 bg-card px-4 py-3.5">
                <p className="text-sm font-medium text-foreground">{previewSubject}</p>
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
                  <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    Ticket reference: T-50001
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMessageModalOpen(true)}
                  disabled={confirmationControlsDisabled}
                >
                  Edit message
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/settings/confirmation/email${selectedConfirmationMailboxId ? `?mailbox_id=${encodeURIComponent(selectedConfirmationMailboxId)}` : ""}`}>Customize email design</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTestConfirmationOpen(true)}>
                  Send test email
                </Button>
              </div>
            </div>
          </SettingsRow>
        </SettingsGroup>
      </div>

        <div className={cn(activeSection !== "routing" && "hidden")}>
          <div className="space-y-3">
            <div className="max-w-3xl">
              <h3 className="text-section-heading font-semibold text-foreground">Email Routing</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Automatically detect non-support emails and route them to the right team.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Emails that don&apos;t match an active category stay in your Sona inbox.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Support emails are always handled in Sona.</p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingRouting}
                  onClick={() => setAddCategoryModalOpen(true)}
                >
                  + Add email category
                </Button>
              </div>
              <div className="overflow-x-auto">
                <div>
                  <div className="grid grid-cols-[1.1fr_2fr_1.2fr_90px_44px] items-center gap-3 border-b border-border/60 pb-2 text-xs text-muted-foreground">
                    <span>Category</span>
                    <span>Forward to</span>
                    <span>Mode</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>
                  {!routingRows.length ? (
                    <p className="py-3 text-sm text-muted-foreground">No email categories yet.</p>
                  ) : null}
                  {routingRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1.1fr_2fr_1.2fr_90px_44px] items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
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
                      className="h-8 w-full border-transparent bg-transparent text-input text-foreground md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
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
                      <SelectTrigger className="h-8 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
                        <SelectValue placeholder="Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual_approval">Manual approval</SelectItem>
                        <SelectItem value="auto_forward">Auto forward</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex justify-end">
                      <SettingsSwitch checked={Boolean(row.is_active)} onCheckedChange={() =>
                          onUpdateRoutingRow?.({
                            ...row,
                            is_active: !Boolean(row.is_active),
                          })} disabled={savingRouting} />
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

        <div className={cn(activeSection !== "sender-rules" && "hidden")}>
          <div className="space-y-3">
            <div className="max-w-3xl">
              <h3 className="text-section-heading font-semibold text-foreground">Sender Rules</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Route new inbound emails by exact sender email or sender domain.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Exact email rules take precedence over domain rules. Only new incoming emails are affected.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingRouting}
                  onClick={() => setAddSenderRuleModalOpen(true)}
                >
                  + Add sender rule
                </Button>
              </div>
              <div className="overflow-x-auto">
                <div>
                  <div className="grid grid-cols-[1fr_1.6fr_1fr_90px_44px] items-center gap-3 border-b border-border/60 pb-2 text-xs text-muted-foreground">
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
                      className="grid grid-cols-[1fr_1.6fr_1fr_90px_44px] items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
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
                        <SelectTrigger className="h-8 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
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
                        className="h-8 w-full border-transparent bg-transparent text-input text-foreground md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
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
                        <SelectTrigger className="h-8 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
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
                        <SettingsSwitch checked={Boolean(row.is_active)} onCheckedChange={() =>
                            onUpdateSenderRuleRow?.({
                              ...row,
                              is_active: !Boolean(row.is_active),
                            })} disabled={savingRouting} />
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
                    <p className="py-3 text-sm text-muted-foreground">
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

        <div className={cn(activeSection !== "blocklist" && "hidden")}>
          <div className="space-y-3">
            <div className="max-w-3xl">
              <h3 className="text-section-heading font-semibold text-foreground">Blocked Senders</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Soft-block future inbound emails by exact sender email or domain.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Blocked emails are stored for audit but hidden from the normal inbox.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingRouting}
                  onClick={() => setAddBlocklistModalOpen(true)}
                >
                  + Add blocked sender
                </Button>
              </div>
              <div className="overflow-x-auto">
                <div>
                  <div className="grid grid-cols-[1fr_1.6fr_1.2fr_90px_44px] items-center gap-3 border-b border-border/60 pb-2 text-xs text-muted-foreground">
                    <span>Type</span>
                    <span>Sender match</span>
                    <span>Note</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>
                  {blocklistRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_1.6fr_1.2fr_90px_44px] items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
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
                        <SelectTrigger className="h-8 border-transparent bg-transparent text-sm hover:border-input focus:border-input focus:ring-2 focus:ring-ring">
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
                        className="h-8 w-full border-transparent bg-transparent text-input text-foreground md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
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
                        className="h-8 w-full border-transparent bg-transparent text-input text-foreground md:text-sm hover:border-input focus:border-input focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={savingRouting}
                      />
                      <div className="flex justify-end">
                        <SettingsSwitch checked={Boolean(row.is_active)} onCheckedChange={() =>
                            onUpdateBlocklistRow?.({
                              ...row,
                              is_active: !Boolean(row.is_active),
                            })} disabled={savingRouting} />
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
                    <p className="py-3 text-sm text-muted-foreground">
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
      <SettingsSaveBar
        visible={canSave}
        saving={saving || savingRouting}
        onSave={onSaveChanges}
        onDiscard={onDiscardChanges}
      />
    </SettingsPage>
  );
}
