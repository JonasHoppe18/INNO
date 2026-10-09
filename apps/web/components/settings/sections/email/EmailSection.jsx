"use client";

import { useCallback, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { EmailSettings } from "@/components/settings/sections/email/EmailSettings";
import { useSettingsDirty } from "@/components/settings/SettingsRouteContext";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { DEFAULT_CONFIRMATION_BODY_TEXT, initialEmailState } from "@/lib/settings/email-state";
import {
  blocklistSnapshot,
  normalizeBlocklistRows,
  normalizeRoutingRows,
  normalizeSenderRuleDestinationType,
  normalizeSenderRuleDestinationValue,
  normalizeSenderRuleMatcherValue,
  normalizeSenderRuleRows,
  routingSnapshot,
  senderRulesSnapshot,
} from "@/lib/settings/email-rows";

function EmailSection({ mode }) {
  const searchParams = useSearchParams();
  const { user } = useUser();
  const { resources, setResource, workspace } = useSettingsWorkspace();
  // Drafts initialize once per mount from the loaded resources.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const emailInit = useMemo(() => initialEmailState(resources, searchParams?.get("mailbox_id") || ""), []);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(emailInit.autoReplyEnabled);
  const [initialAutoReplyEnabled, setInitialAutoReplyEnabled] = useState(emailInit.autoReplyEnabled);
  const [autoReplyIncludeTicketNumber, setAutoReplyIncludeTicketNumber] = useState(emailInit.autoReplyIncludeTicketNumber);
  const [initialAutoReplyIncludeTicketNumber, setInitialAutoReplyIncludeTicketNumber] = useState(emailInit.autoReplyIncludeTicketNumber);
  const [autoReplyInheritsWorkspace, setAutoReplyInheritsWorkspace] = useState(emailInit.autoReplyInheritsWorkspace);
  const [initialAutoReplyInheritsWorkspace, setInitialAutoReplyInheritsWorkspace] = useState(emailInit.autoReplyInheritsWorkspace);
  const [autoReplySubjectTemplate, setAutoReplySubjectTemplate] = useState(emailInit.autoReplySubjectTemplate);
  const [initialAutoReplySubjectTemplate, setInitialAutoReplySubjectTemplate] = useState(emailInit.autoReplySubjectTemplate);
  const [autoReplyBodyTextTemplate, setAutoReplyBodyTextTemplate] = useState(emailInit.autoReplyBodyTextTemplate);
  const [initialAutoReplyBodyTextTemplate, setInitialAutoReplyBodyTextTemplate] = useState(emailInit.autoReplyBodyTextTemplate);
  const [autoReplyBodyHtmlTemplate, setAutoReplyBodyHtmlTemplate] = useState(emailInit.autoReplyBodyHtmlTemplate);
  const [initialAutoReplyBodyHtmlTemplate, setInitialAutoReplyBodyHtmlTemplate] = useState(emailInit.autoReplyBodyHtmlTemplate);
  const [autoReplyTemplateId, setAutoReplyTemplateId] = useState(emailInit.autoReplyTemplateId);
  const [initialAutoReplyTemplateId, setInitialAutoReplyTemplateId] = useState(emailInit.autoReplyTemplateId);
  const [autoReplyTemplateName, setAutoReplyTemplateName] = useState(emailInit.autoReplyTemplateName);
  const [initialAutoReplyTemplateName, setInitialAutoReplyTemplateName] = useState(emailInit.autoReplyTemplateName);
  const [autoReplyTemplateHtml, setAutoReplyTemplateHtml] = useState(emailInit.autoReplyTemplateHtml);
  const [initialAutoReplyTemplateHtml, setInitialAutoReplyTemplateHtml] = useState(emailInit.autoReplyTemplateHtml);
  const [confirmationConfiguration, setConfirmationConfiguration] = useState(emailInit.confirmationConfiguration);
  const [selectedConfirmationMailboxId, setSelectedConfirmationMailboxId] = useState(emailInit.selectedConfirmationMailboxId);
  const [workspaceInboxesForRules] = useState(emailInit.workspaceInboxesForRules);
  const [emailRoutingRows, setEmailRoutingRows] = useState(emailInit.emailRoutingRows);
  const [initialEmailRoutingRows, setInitialEmailRoutingRows] = useState(emailInit.emailRoutingRows);
  const [emailSenderRuleRows, setEmailSenderRuleRows] = useState(emailInit.emailSenderRuleRows);
  const [initialEmailSenderRuleRows, setInitialEmailSenderRuleRows] = useState(emailInit.emailSenderRuleRows);
  const [emailBlocklistRows, setEmailBlocklistRows] = useState(emailInit.emailBlocklistRows);
  const [initialEmailBlocklistRows, setInitialEmailBlocklistRows] = useState(emailInit.emailBlocklistRows);
  const [savingAutoReply, setSavingAutoReply] = useState(false);
  const [savingEmailRouting, setSavingEmailRouting] = useState(false);

  const applyConfirmationScope = useCallback((mailboxId, configuration = confirmationConfiguration) => {
    const normalizedMailboxId = String(mailboxId || "");
    const mailbox = normalizedMailboxId
      ? (configuration?.mailboxes || []).find((row) => String(row?.id || "") === normalizedMailboxId)
      : null;
    const setting = mailbox?.effective || configuration?.workspace_setting || configuration?.setting || {};
    const template = mailbox?.template || configuration?.workspace_template || configuration?.template || {};
    const inherits = Boolean(normalizedMailboxId && mailbox?.inherits_workspace);
    const subject = String(setting?.subject_template || "We've received your message");
    const bodyText = String(setting?.body_text_template || DEFAULT_CONFIRMATION_BODY_TEXT);
    const bodyHtml = String(setting?.body_html_template || "");
    const templateName = String(template?.name || "Customer confirmation template");
    const templateHtml = String(template?.html_layout || "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>");
    const includeTicketNumber = setting?.include_ticket_number !== false;

    setSelectedConfirmationMailboxId(normalizedMailboxId);
    setAutoReplyInheritsWorkspace(inherits);
    setInitialAutoReplyInheritsWorkspace(inherits);
    setAutoReplyEnabled(Boolean(setting?.enabled));
    setInitialAutoReplyEnabled(Boolean(setting?.enabled));
    setAutoReplyIncludeTicketNumber(includeTicketNumber);
    setInitialAutoReplyIncludeTicketNumber(includeTicketNumber);
    setAutoReplySubjectTemplate(subject);
    setInitialAutoReplySubjectTemplate(subject);
    setAutoReplyBodyTextTemplate(bodyText);
    setInitialAutoReplyBodyTextTemplate(bodyText);
    setAutoReplyBodyHtmlTemplate(bodyHtml);
    setInitialAutoReplyBodyHtmlTemplate(bodyHtml);
    setAutoReplyTemplateId(template?.id || setting?.template_id || null);
    setInitialAutoReplyTemplateId(template?.id || setting?.template_id || null);
    setAutoReplyTemplateName(templateName);
    setInitialAutoReplyTemplateName(templateName);
    setAutoReplyTemplateHtml(templateHtml);
    setInitialAutoReplyTemplateHtml(templateHtml);
  }, [confirmationConfiguration]);

  const handleConfirmationMailboxChange = useCallback((mailboxId) => {
    applyConfirmationScope(mailboxId);
  }, [applyConfirmationScope]);

  const handleSaveAutoReply = useCallback(async (overrides = {}, options = {}) => {
    const showToast = options?.showToast !== false;
    if (savingAutoReply) return;
    setSavingAutoReply(true);
    try {
      const nextEnabled =
        typeof overrides.enabled === "boolean" ? overrides.enabled : autoReplyEnabled;
      const nextSubject = String(
        overrides.subject_template ?? autoReplySubjectTemplate ?? ""
      );
      const nextBodyText = String(
        overrides.body_text_template ?? autoReplyBodyTextTemplate ?? ""
      );
      const nextIncludeTicketNumber =
        typeof overrides.include_ticket_number === "boolean"
          ? overrides.include_ticket_number
          : autoReplyIncludeTicketNumber;
      const nextBodyHtml = String(
        overrides.body_html_template ?? autoReplyBodyHtmlTemplate ?? ""
      );
      const nextTemplateId = overrides.template_id ?? autoReplyTemplateId;
      const nextTemplateName = String(
        overrides.template_name ?? autoReplyTemplateName ?? "Default template"
      );
      const nextTemplateHtml = String(
        overrides.template_html ??
          autoReplyTemplateHtml ??
          "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
      );

      const response = await fetch("/api/settings/auto-reply", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailbox_id: selectedConfirmationMailboxId || null,
          inherit: Boolean(selectedConfirmationMailboxId && autoReplyInheritsWorkspace),
          enabled: nextEnabled,
          include_ticket_number: nextIncludeTicketNumber,
          subject_template: nextSubject,
          body_text_template: nextBodyText,
          body_html_template: nextBodyHtml,
          template_id: nextTemplateId,
          template_name: nextTemplateName,
          template_html: nextTemplateHtml,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save customer confirmation settings.");
      setConfirmationConfiguration(payload);
      setResource("/api/settings/auto-reply", payload);
      applyConfirmationScope(selectedConfirmationMailboxId, payload);
      if (showToast) {
        toast.success("Customer confirmation settings saved.");
      }
      return { ok: true };
    } catch (error) {
      const message = error?.message || "Could not save customer confirmation settings.";
      if (showToast) {
        toast.error(message);
      }
      return { ok: false, error: message };
    } finally {
      setSavingAutoReply(false);
    }
  }, [
    applyConfirmationScope,
    autoReplyBodyHtmlTemplate,
    autoReplyBodyTextTemplate,
    autoReplyEnabled,
    autoReplyIncludeTicketNumber,
    autoReplyInheritsWorkspace,
    autoReplySubjectTemplate,
    autoReplyTemplateHtml,
    autoReplyTemplateId,
    autoReplyTemplateName,
    savingAutoReply,
    selectedConfirmationMailboxId,
    setResource,
  ]);

  const handleUpdateEmailRoutingRow = useCallback((row) => {
    const rowId = String(row?.id || "").trim();
    if (!rowId) return;
    setEmailRoutingRows((prev) =>
      prev.map((existing) =>
        existing.id === rowId
          ? {
              ...existing,
              label: String(row?.label || existing.label || "").trim(),
              is_active: Boolean(row?.is_active),
              mode: String(row?.mode || "manual_approval") === "auto_forward" ? "auto_forward" : "manual_approval",
              forward_to_email: String(row?.forward_to_email || ""),
              sort_order: Number.isFinite(Number(row?.sort_order))
                ? Number(row?.sort_order)
                : Number(existing.sort_order || 0),
            }
          : existing
      )
    );
  }, []);

  const handleAddEmailRoutingCategory = useCallback((label) => {
    const cleanLabel = String(label || "").trim();
    if (!cleanLabel) return;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const maxSortOrder = normalizeRoutingRows(emailRoutingRows).reduce(
      (max, row) => Math.max(max, Number(row.sort_order || 0)),
      0
    );
    setEmailRoutingRows((prev) =>
      normalizeRoutingRows([
        ...prev,
        {
          id: tempId,
          category_key: tempId,
          label: cleanLabel,
          is_active: false,
          mode: "manual_approval",
          forward_to_email: "",
          is_default: false,
          sort_order: maxSortOrder + 10,
        },
      ])
    );
  }, [emailRoutingRows]);

  const handleDeleteEmailRoutingCategory = useCallback((row) => {
    const id = String(row?.id || "").trim();
    if (!id) return;
    if (!window.confirm(`Delete routing category "${row?.label || row?.category_key}"?`)) return;
    setEmailRoutingRows((prev) => prev.filter((entry) => String(entry?.id || "") !== id));
  }, []);

  const handleUpdateEmailSenderRuleRow = useCallback((row) => {
    const rowId = String(row?.id || "").trim();
    if (!rowId) return;
    setEmailSenderRuleRows((prev) =>
      prev.map((existing) =>
        existing.id === rowId
          ? {
              ...existing,
              matcher_type: String(row?.matcher_type || existing.matcher_type || "email") === "domain" ? "domain" : "email",
              matcher_value: String(row?.matcher_value || ""),
              destination_type: normalizeSenderRuleDestinationType(
                row?.destination_type || existing.destination_type || "classification"
              ),
              destination_value: normalizeSenderRuleDestinationValue(
                normalizeSenderRuleDestinationType(
                  row?.destination_type || existing.destination_type || "classification"
                ),
                row?.destination_value || existing.destination_value || "notification"
              ),
              is_active: typeof row?.is_active === "boolean" ? row.is_active : Boolean(existing?.is_active),
            }
          : existing
      )
    );
  }, []);

  const handleAddEmailSenderRule = useCallback((rule) => {
    const matcherType = String(rule?.matcher_type || "email").trim().toLowerCase() === "domain" ? "domain" : "email";
    const matcherValue = String(rule?.matcher_value || "").trim().toLowerCase();
    const destinationType = normalizeSenderRuleDestinationType(
      rule?.destination_type || "classification"
    );
    const destinationValue = normalizeSenderRuleDestinationValue(
      destinationType,
      rule?.destination_value || "notification"
    );
    if (!matcherValue || !destinationValue) return;
    const tempId = `tmp_sender_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setEmailSenderRuleRows((prev) =>
      normalizeSenderRuleRows([
        ...prev,
        {
          id: tempId,
          matcher_type: matcherType,
          matcher_value: matcherValue,
          destination_type: destinationType,
          destination_value: destinationValue,
          is_active: true,
        },
      ])
    );
  }, []);

  const handleDeleteEmailSenderRule = useCallback((row) => {
    const id = String(row?.id || "").trim();
    if (!id) return;
    if (!window.confirm(`Delete sender rule "${row?.matcher_value || id}"?`)) return;
    setEmailSenderRuleRows((prev) => prev.filter((entry) => String(entry?.id || "") !== id));
  }, []);

  const handleUpdateEmailBlocklistRow = useCallback((row) => {
    const rowId = String(row?.id || "").trim();
    if (!rowId) return;
    setEmailBlocklistRows((prev) =>
      prev.map((existing) =>
        existing.id === rowId
          ? {
              ...existing,
              matcher_type: String(row?.matcher_type || existing.matcher_type || "email") === "domain" ? "domain" : "email",
              matcher_value: String(row?.matcher_value || ""),
              note: String(row?.note || "").slice(0, 300),
              is_active: typeof row?.is_active === "boolean" ? row.is_active : Boolean(existing?.is_active),
            }
          : existing
      )
    );
  }, []);

  const handleAddEmailBlocklistRow = useCallback((block) => {
    const matcherType = String(block?.matcher_type || "email").trim().toLowerCase() === "domain" ? "domain" : "email";
    const matcherValue = String(block?.matcher_value || "").trim().toLowerCase();
    if (!matcherValue) return;
    const tempId = `tmp_blocklist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setEmailBlocklistRows((prev) =>
      normalizeBlocklistRows([
        ...prev,
        {
          id: tempId,
          matcher_type: matcherType,
          matcher_value: matcherValue,
          note: String(block?.note || "").slice(0, 300),
          is_active: true,
        },
      ])
    );
  }, []);

  const handleDeleteEmailBlocklistRow = useCallback((row) => {
    const id = String(row?.id || "").trim();
    if (!id) return;
    if (!window.confirm(`Delete blocked sender "${row?.matcher_value || id}"?`)) return;
    setEmailBlocklistRows((prev) => prev.filter((entry) => String(entry?.id || "") !== id));
  }, []);

  const hasAutoReplyChanges = useMemo(() => {
    if (Boolean(autoReplyEnabled) !== Boolean(initialAutoReplyEnabled)) return true;
    if (Boolean(autoReplyIncludeTicketNumber) !== Boolean(initialAutoReplyIncludeTicketNumber)) return true;
    if (Boolean(autoReplyInheritsWorkspace) !== Boolean(initialAutoReplyInheritsWorkspace)) return true;
    if (String(autoReplySubjectTemplate || "") !== String(initialAutoReplySubjectTemplate || "")) return true;
    if (String(autoReplyBodyTextTemplate || "") !== String(initialAutoReplyBodyTextTemplate || "")) return true;
    if (String(autoReplyBodyHtmlTemplate || "") !== String(initialAutoReplyBodyHtmlTemplate || "")) return true;
    if (String(autoReplyTemplateId || "") !== String(initialAutoReplyTemplateId || "")) return true;
    if (String(autoReplyTemplateName || "") !== String(initialAutoReplyTemplateName || "")) return true;
    if (String(autoReplyTemplateHtml || "") !== String(initialAutoReplyTemplateHtml || "")) return true;
    return false;
  }, [
    autoReplyBodyHtmlTemplate,
    autoReplyBodyTextTemplate,
    autoReplyEnabled,
    autoReplyIncludeTicketNumber,
    autoReplyInheritsWorkspace,
    autoReplySubjectTemplate,
    autoReplyTemplateHtml,
    autoReplyTemplateId,
    autoReplyTemplateName,
    initialAutoReplyBodyHtmlTemplate,
    initialAutoReplyBodyTextTemplate,
    initialAutoReplyEnabled,
    initialAutoReplyIncludeTicketNumber,
    initialAutoReplyInheritsWorkspace,
    initialAutoReplySubjectTemplate,
    initialAutoReplyTemplateHtml,
    initialAutoReplyTemplateId,
    initialAutoReplyTemplateName,
  ]);

  const hasRoutingChanges = useMemo(
    () => routingSnapshot(emailRoutingRows) !== routingSnapshot(initialEmailRoutingRows),
    [emailRoutingRows, initialEmailRoutingRows]
  );

  const hasSenderRulesChanges = useMemo(
    () => senderRulesSnapshot(emailSenderRuleRows) !== senderRulesSnapshot(initialEmailSenderRuleRows),
    [emailSenderRuleRows, initialEmailSenderRuleRows]
  );

  const hasBlocklistChanges = useMemo(
    () => blocklistSnapshot(emailBlocklistRows) !== blocklistSnapshot(initialEmailBlocklistRows),
    [emailBlocklistRows, initialEmailBlocklistRows]
  );

  // Each page only edits its own part, so only that part can make the page dirty.
  const canSaveEmailSettings = useMemo(() => {
    return mode === "inbox-rules"
      ? hasRoutingChanges || hasSenderRulesChanges || hasBlocklistChanges
      : hasAutoReplyChanges;
  }, [mode, hasAutoReplyChanges, hasRoutingChanges, hasSenderRulesChanges, hasBlocklistChanges]);

  const handleDiscardEmailSettings = useCallback(() => {
    setAutoReplyEnabled(Boolean(initialAutoReplyEnabled));
    setAutoReplyIncludeTicketNumber(Boolean(initialAutoReplyIncludeTicketNumber));
    setAutoReplyInheritsWorkspace(Boolean(initialAutoReplyInheritsWorkspace));
    setAutoReplySubjectTemplate(String(initialAutoReplySubjectTemplate || "We've received your message"));
    setAutoReplyBodyTextTemplate(String(initialAutoReplyBodyTextTemplate || ""));
    setAutoReplyBodyHtmlTemplate(String(initialAutoReplyBodyHtmlTemplate || ""));
    setAutoReplyTemplateId(initialAutoReplyTemplateId || null);
    setAutoReplyTemplateName(String(initialAutoReplyTemplateName || "Default template"));
    setAutoReplyTemplateHtml(String(initialAutoReplyTemplateHtml || ""));
    setEmailRoutingRows(normalizeRoutingRows(initialEmailRoutingRows));
    setEmailSenderRuleRows(normalizeSenderRuleRows(initialEmailSenderRuleRows));
    setEmailBlocklistRows(normalizeBlocklistRows(initialEmailBlocklistRows));
  }, [
    initialAutoReplyBodyHtmlTemplate,
    initialAutoReplyBodyTextTemplate,
    initialAutoReplyEnabled,
    initialAutoReplyIncludeTicketNumber,
    initialAutoReplyInheritsWorkspace,
    initialAutoReplySubjectTemplate,
    initialAutoReplyTemplateHtml,
    initialAutoReplyTemplateId,
    initialAutoReplyTemplateName,
    initialEmailRoutingRows,
    initialEmailSenderRuleRows,
    initialEmailBlocklistRows,
  ]);

  const handleSaveEmailSettings = useCallback(async () => {
    if (!canSaveEmailSettings || savingEmailRouting || savingAutoReply) return;
    setSavingEmailRouting(true);
    try {
      if (hasAutoReplyChanges) {
        const autoReplyResult = await handleSaveAutoReply(
          {
            enabled: autoReplyEnabled,
            include_ticket_number: autoReplyIncludeTicketNumber,
            subject_template: autoReplySubjectTemplate,
            body_text_template: autoReplyBodyTextTemplate,
            body_html_template: autoReplyBodyHtmlTemplate,
            template_id: autoReplyTemplateId,
            template_name: autoReplyTemplateName,
            template_html: autoReplyTemplateHtml,
          },
          { showToast: false }
        );
        if (!autoReplyResult?.ok) {
          throw new Error(autoReplyResult?.error || "Could not save customer confirmation settings.");
        }
      }

      if (hasRoutingChanges) {
        const routingRows = normalizeRoutingRows(emailRoutingRows);
        const initialRows = normalizeRoutingRows(initialEmailRoutingRows);
        const currentIds = new Set(routingRows.map((row) => String(row.id)));
        const deletedRows = initialRows.filter((row) => !currentIds.has(String(row.id)));

        for (const row of deletedRows) {
          const response = await fetch("/api/settings/email-routing", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: row.id }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not delete email route.");
          }
        }

        for (const row of routingRows) {
          const label = String(row.label || "").trim();
          if (!label) {
            throw new Error("Category label is required.");
          }
          const isTemporary = String(row.id).startsWith("tmp_");
          const method = isTemporary ? "POST" : "PUT";
          const requestBody = isTemporary
            ? {
                label,
                is_active: Boolean(row.is_active),
                mode: String(row.mode || "manual_approval"),
                forward_to_email: String(row.forward_to_email || "").trim(),
                sort_order: Number(row.sort_order || 0),
              }
            : {
                id: row.id,
                label,
                is_active: Boolean(row.is_active),
                mode: String(row.mode || "manual_approval"),
                forward_to_email: String(row.forward_to_email || "").trim(),
                sort_order: Number(row.sort_order || 0),
              };
          const response = await fetch("/api/settings/email-routing", {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(requestBody),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not save email route.");
          }
        }

        const refreshResponse = await fetch("/api/settings/email-routing", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        const refreshPayload = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok) {
          throw new Error(refreshPayload?.error || "Could not reload email routes.");
        }
        const persistedRows = normalizeRoutingRows(refreshPayload?.routes || []);
        setResource("/api/settings/email-routing", refreshPayload);
        setInitialEmailRoutingRows(persistedRows);
        setEmailRoutingRows(persistedRows);
      }

      if (hasSenderRulesChanges) {
        const senderRuleRows = normalizeSenderRuleRows(emailSenderRuleRows);
        const initialRows = normalizeSenderRuleRows(initialEmailSenderRuleRows);
        const currentIds = new Set(senderRuleRows.map((row) => String(row.id)));
        const deletedRows = initialRows.filter((row) => !currentIds.has(String(row.id)));

        for (const row of deletedRows) {
          const response = await fetch("/api/settings/email-sender-rules", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: row.id }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not delete sender rule.");
          }
        }

        for (const row of senderRuleRows) {
          const matcherType = String(row.matcher_type || "").trim().toLowerCase();
          const matcherValue = String(row.matcher_value || "").trim().toLowerCase();
          const destinationType = normalizeSenderRuleDestinationType(row.destination_type);
          const destinationValue = normalizeSenderRuleDestinationValue(
            destinationType,
            row.destination_value
          );
          if (!matcherType || !matcherValue || !destinationType || !destinationValue) {
            throw new Error("Sender rule requires matcher type, match value, and destination.");
          }

          const isTemporary = String(row.id).startsWith("tmp_sender_rule_");
          const method = isTemporary ? "POST" : "PUT";
          const requestBody = isTemporary
            ? {
                matcher_type: matcherType,
                matcher_value: matcherValue,
                destination_type: destinationType,
                destination_value: destinationValue,
                is_active: Boolean(row.is_active),
              }
            : {
                id: row.id,
                matcher_type: matcherType,
                matcher_value: matcherValue,
                destination_type: destinationType,
                destination_value: destinationValue,
                is_active: Boolean(row.is_active),
              };

          const response = await fetch("/api/settings/email-sender-rules", {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(requestBody),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not save sender rule.");
          }
        }

        const refreshResponse = await fetch("/api/settings/email-sender-rules", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        const refreshPayload = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok) {
          throw new Error(refreshPayload?.error || "Could not reload sender rules.");
        }
        const persistedRules = normalizeSenderRuleRows(refreshPayload?.rules || []);
        setResource("/api/settings/email-sender-rules", refreshPayload);
        setInitialEmailSenderRuleRows(persistedRules);
        setEmailSenderRuleRows(persistedRules);
      }

      if (hasBlocklistChanges) {
        const blockRows = normalizeBlocklistRows(emailBlocklistRows);
        const initialRows = normalizeBlocklistRows(initialEmailBlocklistRows);
        const currentIds = new Set(blockRows.map((row) => String(row.id)));
        const deletedRows = initialRows.filter((row) => !currentIds.has(String(row.id)));

        for (const row of deletedRows) {
          const response = await fetch("/api/settings/email-blocklist", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: row.id }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not delete blocked sender.");
          }
        }

        for (const row of blockRows) {
          const matcherType = String(row.matcher_type || "").trim().toLowerCase();
          const matcherValue = normalizeSenderRuleMatcherValue(matcherType, row.matcher_value);
          if (!matcherType || !matcherValue) {
            throw new Error("Blocked sender requires a valid email or domain.");
          }

          const isTemporary = String(row.id).startsWith("tmp_blocklist_");
          const method = isTemporary ? "POST" : "PUT";
          const requestBody = isTemporary
            ? {
                matcher_type: matcherType,
                matcher_value: matcherValue,
                note: String(row.note || "").trim(),
                is_active: Boolean(row.is_active),
              }
            : {
                id: row.id,
                matcher_type: matcherType,
                matcher_value: matcherValue,
                note: String(row.note || "").trim(),
                is_active: Boolean(row.is_active),
              };

          const response = await fetch("/api/settings/email-blocklist", {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(requestBody),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not save blocked sender.");
          }
        }

        const refreshResponse = await fetch("/api/settings/email-blocklist", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        const refreshPayload = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok) {
          throw new Error(refreshPayload?.error || "Could not reload blocked senders.");
        }
        const persistedBlocks = normalizeBlocklistRows(refreshPayload?.blocks || []);
        setResource("/api/settings/email-blocklist", refreshPayload);
        setInitialEmailBlocklistRows(persistedBlocks);
        setEmailBlocklistRows(persistedBlocks);
      }

      toast.success(mode === "inbox-rules" ? "Inbox rules saved." : "Confirmation email saved.");
    } catch (error) {
      toast.error(error?.message || "Could not save email settings.");
    } finally {
      setSavingEmailRouting(false);
    }
  }, [
    autoReplyBodyHtmlTemplate,
    autoReplyBodyTextTemplate,
    autoReplyEnabled,
    autoReplyIncludeTicketNumber,
    autoReplySubjectTemplate,
    autoReplyTemplateHtml,
    autoReplyTemplateId,
    autoReplyTemplateName,
    canSaveEmailSettings,
    mode,
    emailBlocklistRows,
    emailRoutingRows,
    emailSenderRuleRows,
    hasAutoReplyChanges,
    hasBlocklistChanges,
    hasRoutingChanges,
    hasSenderRulesChanges,
    handleSaveAutoReply,
    initialEmailRoutingRows,
    initialEmailSenderRuleRows,
    initialEmailBlocklistRows,
    savingAutoReply,
    savingEmailRouting,
    setResource,
  ]);

  useSettingsDirty(canSaveEmailSettings);

  return (
      <EmailSettings
        mode={mode}
        enabled={autoReplyEnabled}
        onEnabledChange={setAutoReplyEnabled}
        subjectTemplate={autoReplySubjectTemplate}
        bodyTextTemplate={autoReplyBodyTextTemplate}
        bodyHtmlTemplate={autoReplyBodyHtmlTemplate}
        confirmationTemplateHtml={autoReplyTemplateHtml}
        includeTicketNumber={autoReplyIncludeTicketNumber}
        onIncludeTicketNumberChange={setAutoReplyIncludeTicketNumber}
        confirmationMailboxes={confirmationConfiguration?.mailboxes || []}
        selectedConfirmationMailboxId={selectedConfirmationMailboxId}
        onConfirmationMailboxChange={handleConfirmationMailboxChange}
        inheritsWorkspace={autoReplyInheritsWorkspace}
        onInheritsWorkspaceChange={setAutoReplyInheritsWorkspace}
        currentUserEmail={user?.primaryEmailAddress?.emailAddress || ""}
        teamName={workspace.workspaceName}
        routingRows={emailRoutingRows}
        onUpdateRoutingRow={handleUpdateEmailRoutingRow}
        onAddRoutingCategory={handleAddEmailRoutingCategory}
        onDeleteRoutingCategory={handleDeleteEmailRoutingCategory}
        senderRuleRows={emailSenderRuleRows}
        senderRuleInboxes={workspaceInboxesForRules}
        onUpdateSenderRuleRow={handleUpdateEmailSenderRuleRow}
        onAddSenderRule={handleAddEmailSenderRule}
        onDeleteSenderRule={handleDeleteEmailSenderRule}
        blocklistRows={emailBlocklistRows}
        onUpdateBlocklistRow={handleUpdateEmailBlocklistRow}
        onAddBlocklistRow={handleAddEmailBlocklistRow}
        onDeleteBlocklistRow={handleDeleteEmailBlocklistRow}
        canSave={canSaveEmailSettings}
        onSaveChanges={handleSaveEmailSettings}
        onDiscardChanges={handleDiscardEmailSettings}
        savingRouting={savingEmailRouting}
        saving={savingAutoReply || savingEmailRouting}
      />
  );
}

export function ConfirmationEmailSection() {
  return <EmailSection mode="confirmation" />;
}

export function InboxRulesSection() {
  return <EmailSection mode="inbox-rules" />;
}
