"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { reportClientEvent } from "@/lib/client-events";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const DRAFT_FETCH_DELAY_MS = 150;

// Verbatim extraction from InboxSplitView.jsx (Task 5, Plan 2). Behavior-preserving —
// see .superpowers/sdd/task-5-report.md for the mapping of what moved from where.
//
// Owns composer orchestration:
//   - composerMode (+ the reset-to-"reply" effect on thread switch),
//     draftValue/draftValueByThread/noteValueByThread, activeDraftId, isSending.
//   - draftLogId/draftLogIdByThread/draftLogLoading (+ the fetch effect).
//   - Draft-generation guard state: suppressAutoDraftByThread,
//     manualDraftGeneratingByThread, postApprovalDraftLoadingByThread,
//     refineDraftLoadingByThread, systemDraftUneditedByThread, draftReady,
//     draftWaitTimedOutByThread, staleDraftByThread, proposalOnlyByThread,
//     tagsRefreshTriggerByThread.
//   - Handlers: handleGenerateDraft, handleRefineDraft, handleDraftChange,
//     saveThreadDraft (+ its 4s auto-save interval effect), and handleSendDraft.
//
// handleSendDraft accepts an optional second `{ onSent }` argument and
// invokes it exactly once, at the end of the success path, after the
// optimistic status update block. InboxSplitView.jsx wires this to
// selectNext() (Task 10, Plan 2) when the active view is a queue view
// (needs_attention/mine/an inbox's needs-attention tab) — outside those
// views onSent is omitted and behavior is unchanged.
export function useComposerState({
  // Data this hook reads but does not own.
  selectedThreadId,
  selectedThreadIdRef,
  selectedThread,
  selectedThreadDetail,
  messagesFetchedForThreadId,
  selectedThreadMessagesLoading,
  isLocalThreadId,
  supabase,
  derivedThreads,
  aiDraft,
  draftMessage,
  latestRealMessageIsOutbound,
  inboundMessageCount,
  mailboxEmails,
  currentSupabaseUserId,
  currentUserName,
  draftCacheRef,
  refreshSelectedThreadMessages,
  refreshSelectedThreadMessagesRef,
  // Thread-actions state/setters this hook's guards/handlers read or write
  // (owned by useThreadActions, passed in the same way Task 4 threaded
  // useThreadSelection's setters into handlers that needed them).
  pendingOrderUpdateByThread,
  setPendingOrderUpdateByThread,
  setReturnCaseByThread,
  setOrderUpdateDecisionByThread,
  // Setters/refs owned elsewhere that this hook's handlers must update too.
  setLiveThreads,
  setTicketStateByThread,
  setSentDraftStatsByThread,
  setLocalSentMessagesByThread,
  // Pure helpers/constants owned by InboxSplitView.jsx.
  asString,
  getDecisionFromActionStatus,
  DEFAULT_TICKET_STATE,
}) {
  const [composerMode, setComposerMode] = useState("reply");
  const [draftValue, setDraftValue] = useState("");
  const [draftValueByThread, setDraftValueByThread] = useState({});
  const [noteValueByThread, setNoteValueByThread] = useState({});
  const [, setSignatureByThread] = useState({});
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [suppressAutoDraftByThread, setSuppressAutoDraftByThread] = useState(
    {},
  );
  const [proposalOnlyByThread, setProposalOnlyByThread] = useState({});
  const [draftReady, setDraftReady] = useState(false);
  const [draftWaitTimedOutByThread, setDraftWaitTimedOutByThread] = useState(
    {},
  );
  const [systemDraftUneditedByThread, setSystemDraftUneditedByThread] =
    useState({});
  const [manualDraftGeneratingByThread, setManualDraftGeneratingByThread] =
    useState({});
  const [postApprovalDraftLoadingByThread, setPostApprovalDraftLoadingByThread] =
    useState({});
  const [refineDraftLoadingByThread, setRefineDraftLoadingByThread] = useState(
    {},
  );
  const [tagsRefreshTriggerByThread, setTagsRefreshTriggerByThread] = useState(
    {},
  );
  const [staleDraftByThread, setStaleDraftByThread] = useState({});
  const [draftLogId, setDraftLogId] = useState(null);
  const [draftLogLoading, setDraftLogLoading] = useState(false);
  const [draftLogIdByThread, setDraftLogIdByThread] = useState({});

  const sendingStartedAtRef = useRef(0);
  const draftLastSavedRef = useRef({});
  const savingDraftThreadIdsRef = useRef(new Set());
  const draftValueRef = useRef("");
  // Ref that always holds the latest systemDraftUneditedByThread value so effects
  // can read it without needing it as a dependency.
  const systemDraftUneditedRef = useRef({});

  useEffect(() => {
    draftValueRef.current = draftValue;
  }, [draftValue]);

  useEffect(() => {
    systemDraftUneditedRef.current = systemDraftUneditedByThread;
  }, [systemDraftUneditedByThread]);

  const activeNoteValue = selectedThreadId
    ? noteValueByThread[selectedThreadId] || ""
    : "";
  const composerValue = composerMode === "note" ? activeNoteValue : draftValue;

  useEffect(() => {
    if (!selectedThreadId) return;
    setComposerMode("reply");
  }, [selectedThreadId]);

  // Keep the per-thread draft map across ticket switches. A draft can be
  // generated or autosaved while the agent is switching away, so deleting the
  // local entry here can make the composer briefly (or permanently) empty when
  // the agent returns before the server response has landed.
  useEffect(() => {
    if (!selectedThreadId) return;
    // A hover-prefetched server payload must never replace an in-session draft.
    if (Object.prototype.hasOwnProperty.call(draftValueByThread, selectedThreadId)) {
      draftCacheRef.current.delete(selectedThreadId);
    }
  }, [draftCacheRef, draftValueByThread, selectedThreadId]);

  // Detail-fetch effect: hydrate draft state (signature/proposalOnly/draftValue/
  // systemDraftUnedited/activeDraftId/draftReady) and sentDraftStatsByThread from
  // the thread detail payload once messages for the selected thread have loaded.
  useEffect(() => {
    if (!selectedThreadId || messagesFetchedForThreadId !== selectedThreadId) return;
    if (!selectedThreadDetail || typeof selectedThreadDetail !== "object") return;

    const detailDraftStats = selectedThreadDetail.draftStats || null;
    if (detailDraftStats?.edit_classification) {
      setSentDraftStatsByThread((prev) =>
        prev[selectedThreadId] ? prev : { ...prev, [selectedThreadId]: detailDraftStats },
      );
    }

    const detailDraftPayload = selectedThreadDetail.draft || null;
    if (detailDraftPayload && typeof detailDraftPayload === "object") {
      setSignatureByThread((prev) => ({
        ...prev,
        [selectedThreadId]: String(detailDraftPayload.signature || ""),
      }));
      setProposalOnlyByThread((prev) => ({
        ...prev,
        [selectedThreadId]: detailDraftPayload.proposal_only === true,
      }));
      const draft = detailDraftPayload.draft || null;
      // The detail endpoint always returns a draft payload wrapper, even when
      // there is no persisted draft. Only hydrate the composer when the
      // wrapper contains an actual draft row; otherwise the dedicated draft
      // fetch below must still be allowed to run.
      if (draft && typeof draft === "object") {
        if (draft?.id) setActiveDraftId(draft.id);
        if (
          !Object.prototype.hasOwnProperty.call(draftValueByThread, selectedThreadId)
        ) {
          const draftText = draft?.body_text || draft?.body_html || "";
          setDraftValue(draftText);
          setDraftValueByThread((prev) => ({
            ...prev,
            [selectedThreadId]: draftText,
          }));
          setSystemDraftUneditedByThread((prev) => ({
            ...prev,
            [selectedThreadId]: Boolean(draftText),
          }));
          draftLastSavedRef.current[selectedThreadId] = String(draftText || "").trim();
        }
        setDraftReady(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftValueByThread is intentionally omitted: it's only read once for a "first-time-seeing-this-thread" guard. Including it in deps caused React error #185 (Maximum update depth exceeded) pre-extraction — every composer keystroke mutates draftValueByThread, which would re-run this effect and fire fresh-object-ref setStates on every keystroke. Preserved verbatim from InboxSplitView.jsx.
  }, [
    messagesFetchedForThreadId,
    selectedThreadDetail,
    selectedThreadId,
  ]);

  // Fetch (and cache per-thread) the drafts-table row id backing the selected
  // thread's draft, used by SonaInsightsModal.
  useEffect(() => {
    if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
    let active = true;
    const fetchDraftLogId = async () => {
      const cachedDraftLogId = draftLogIdByThread[selectedThreadId] ?? null;
      if (cachedDraftLogId !== null) {
        setDraftLogId(cachedDraftLogId);
        setDraftLogLoading(false);
        return;
      }
      setDraftLogLoading(true);
      const draftThreadId =
        selectedThread?.provider_thread_id || selectedThread?.id || null;
      if (!supabase || !draftThreadId) {
        if (active) {
          setDraftLogId(null);
          setDraftLogLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("drafts")
        .select("id")
        .eq("thread_id", draftThreadId)
        .eq("platform", selectedThread?.provider || "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setDraftLogId(null);
        setDraftLogLoading(false);
        return;
      }
      const nextId =
        typeof data?.id === "string" && data.id.trim()
          ? data.id
          : typeof data?.id === "number"
            ? data.id
            : null;
      setDraftLogId(nextId);
      if (nextId) {
        setDraftLogIdByThread((prev) => {
          if (prev?.[selectedThreadId] === nextId) return prev;
          return {
            ...(prev || {}),
            [selectedThreadId]: nextId,
          };
        });
      }
      setDraftLogLoading(false);
    };
    fetchDraftLogId();
    return () => {
      active = false;
    };
  }, [
    isLocalThreadId,
    selectedThread?.id,
    selectedThread?.provider,
    selectedThread?.provider_thread_id,
    selectedThreadId,
    supabase,
    draftLogIdByThread,
  ]);

  // Reset draftValue/activeDraftId/draftReady from draftValueByThread whenever
  // the selected thread changes.
  useEffect(() => {
    if (!selectedThreadId) {
      setDraftValue("");
      setActiveDraftId(null);
      setDraftReady(false);
      return;
    }

    const hasThreadDraft = Object.prototype.hasOwnProperty.call(
      draftValueByThread,
      selectedThreadId,
    );
    if (hasThreadDraft) {
      setDraftValue(String(draftValueByThread[selectedThreadId] || ""));
      setDraftReady(true);
    } else {
      setDraftValue("");
      setActiveDraftId(null);
      setDraftReady(false);
    }
    setDraftWaitTimedOutByThread((prev) => {
      if (prev[selectedThreadId] === false || !(selectedThreadId in prev))
        return prev;
      const next = { ...prev };
      next[selectedThreadId] = false;
      return next;
    });
  }, [draftValueByThread, selectedThreadId]);

  useEffect(() => {
    let active = true;
    const loadDraft = async () => {
      if (isLocalThreadId(selectedThreadId)) {
        setDraftReady(true);
        return;
      }
      if (!selectedThreadId) return;
      // Once a thread has a local draft entry, keep it authoritative for this
      // session. This prevents a slow/stale server response (including an
      // empty response while a save is in flight) from clearing the composer
      // during a ticket switch.
      if (
        Object.prototype.hasOwnProperty.call(draftValueByThread, selectedThreadId)
      ) {
        setDraftReady(true);
        return;
      }
      const cachedDraftPayload = draftCacheRef.current.get(selectedThreadId);
      draftCacheRef.current.delete(selectedThreadId);
      const res = cachedDraftPayload
        ? { ok: true, json: async () => cachedDraftPayload }
        : await fetch(`/api/threads/${selectedThreadId}/draft`, {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          }).catch(() => null);
      if (!active) return;
      if (!res?.ok) {
        setDraftReady(true);
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!active) return;
      const draft = payload?.draft || null;
      const proposalOnly = payload?.proposal_only === true;
      const signature = String(payload?.signature || "");
      setSignatureByThread((prev) => ({
        ...prev,
        [selectedThreadId]: signature,
      }));
      setProposalOnlyByThread((prev) => ({
        ...prev,
        [selectedThreadId]: proposalOnly,
      }));
      const existingThreadDraft = String(
        draftValueByThread[selectedThreadId] || "",
      );
      const activeThreadDraft =
        selectedThreadIdRef.current === selectedThreadId
          ? String(draftValueRef.current || "")
          : "";
      const hasExistingLocalDraft = Boolean(
        existingThreadDraft.trim() || activeThreadDraft.trim(),
      );
      const hasLocalUserEdits =
        Object.prototype.hasOwnProperty.call(draftValueByThread, selectedThreadId) &&
        systemDraftUneditedRef.current[selectedThreadId] === false;

      // A quick ticket switch can finish the server request after the agent
      // has already typed in this thread. Keep that local value authoritative
      // until autosave catches up; an older server draft must not overwrite it.
      if (hasLocalUserEdits) {
        setDraftReady(true);
        return;
      }

      if (proposalOnly && !draft) {
        // Guard: never clobber an existing local draft when server says proposal_only + no draft.
        // This can happen due timing/race between thread refreshes and draft fetches.
        if (hasExistingLocalDraft) {
          setDraftReady(true);
          return;
        }
        setSuppressAutoDraftByThread((prev) => ({
          ...prev,
          [selectedThreadId]: true,
        }));
        if (selectedThreadIdRef.current === selectedThreadId) {
          setDraftValue("");
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: "",
        }));
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
        if (selectedThreadIdRef.current === selectedThreadId) {
          setActiveDraftId(null);
        }
        setDraftReady(true);
        return;
      }
      setSuppressAutoDraftByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      const draftText = draft?.body_text || draft?.body_html || "";
      if (draftText) {
        if (selectedThreadIdRef.current === selectedThreadId) {
          setDraftValue(draftText);
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: draftText,
        }));
        draftLastSavedRef.current[selectedThreadId] = draftText.trim();
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: true,
        }));
      } else {
        // Server has no draft. Always record this so auto-save doesn't treat
        // an unknown baseline as "changed" and re-write stale cached content. — 2026-05-26
        draftLastSavedRef.current[selectedThreadId] = "";
        // Read from ref so this effect doesn't depend on systemDraftUneditedByThread —
        // having it as a dep causes an infinite re-render loop because the effect
        // also calls setSystemDraftUneditedByThread below. — 2026-05-26
        const isSystemUnedited =
          systemDraftUneditedRef.current[selectedThreadId] === true;
        if (hasExistingLocalDraft && !isSystemUnedited) {
          // User typed their own content that the server doesn't have yet —
          // preserve it but we've already recorded the server baseline above.
          setDraftReady(true);
          return;
        }
        // Server confirmed empty and local draft is AI-generated (unedited by user).
        // Clear it so we don't auto-save old AI content back to the server.
        if (selectedThreadIdRef.current === selectedThreadId) {
          setDraftValue("");
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: "",
        }));
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
      }
      if (draft?.id) {
        setActiveDraftId(draft.id);
      }
      setDraftReady(true);
    };
    const timerId = setTimeout(() => {
      if (
        selectedThreadMessagesLoading &&
        messagesFetchedForThreadId !== selectedThreadId
      )
        return;
      if (
        messagesFetchedForThreadId === selectedThreadId &&
        selectedThreadDetail?.draft?.draft
      ) {
        setDraftReady(true);
        return;
      }
      loadDraft();
    }, DRAFT_FETCH_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- systemDraftUneditedByThread intentionally omitted: effect also sets it via setSystemDraftUneditedByThread, adding it as a dep would create an infinite re-render loop. We read the latest value via systemDraftUneditedRef.current instead.
  }, [
    draftValueByThread,
    isLocalThreadId,
    messagesFetchedForThreadId,
    selectedThreadDetail,
    selectedThreadId,
    selectedThreadMessagesLoading,
  ]);

  useEffect(() => {
    if (!selectedThreadId || !draftReady || !aiDraft) return;
    if (proposalOnlyByThread[selectedThreadId]) return;
    if (pendingOrderUpdateByThread[selectedThreadId]) return;
    if (suppressAutoDraftByThread[selectedThreadId]) return;
    // Allow overwriting an existing system draft that hasn't been edited by the agent,
    // so new customer messages replace stale auto-generated drafts.
    if (draftValueRef.current && !systemDraftUneditedByThread[selectedThreadId])
      return;
    setDraftValue(aiDraft);
    setDraftValueByThread((prev) => ({
      ...prev,
      [selectedThreadId]: aiDraft,
    }));
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- systemDraftUneditedByThread intentionally omitted: effect also sets it, adding it would cause an infinite loop
  }, [
    aiDraft,
    draftReady,
    pendingOrderUpdateByThread,
    proposalOnlyByThread,
    selectedThreadId,
    suppressAutoDraftByThread,
  ]);

  useEffect(() => {
    if (!selectedThreadId || !draftReady || !latestRealMessageIsOutbound) return;
    if (!draftValueRef.current) return;
    if (!systemDraftUneditedRef.current[selectedThreadId]) return;
    setDraftValue("");
    setDraftValueByThread((prev) => ({
      ...prev,
      [selectedThreadId]: "",
    }));
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: false,
    }));
    setSuppressAutoDraftByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
  }, [draftReady, latestRealMessageIsOutbound, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    if (!suppressAutoDraftByThread[selectedThreadId]) return;
    if (aiDraft || draftMessage) return;
    setSuppressAutoDraftByThread((prev) => {
      if (!prev[selectedThreadId]) return prev;
      const next = { ...prev };
      delete next[selectedThreadId];
      return next;
    });
  }, [aiDraft, draftMessage, selectedThreadId, suppressAutoDraftByThread]);

  useEffect(() => {
    if (!selectedThreadId || !draftReady || !draftMessage) return;
    // Only block if the draft was explicitly deleted by the user (saveThreadDraft DELETE path sets
    // draftLastSavedRef to ""). suppressAutoDraftByThread is intentionally NOT checked here because
    // it can be set by loadDraft when proposal_only=true and no API draft is found, even though a
    // real is_draft=true row may exist in rawThreadMessages (e.g. on a sibling thread). A real DB
    // draft should always win.
    if (draftLastSavedRef.current[selectedThreadId] === "") return;
    const draftBody = draftMessage.body_text || draftMessage.body_html || "";
    // Realtime can briefly deliver an empty draft row; never clobber a loaded draft with empty content.
    if (!String(draftBody || "").trim()) return;
    // Allow overwriting an existing system draft that hasn't been edited by the agent,
    // so new customer messages replace stale auto-generated drafts.
    if (draftValueRef.current && !systemDraftUneditedByThread[selectedThreadId])
      return;
    setDraftValue(draftBody);
    setDraftValueByThread((prev) => ({
      ...prev,
      [selectedThreadId]: draftBody,
    }));
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- systemDraftUneditedByThread intentionally omitted: effect also sets it, adding it would cause an infinite loop; suppressAutoDraftByThread intentionally omitted: we use draftLastSavedRef instead
  }, [draftMessage, draftReady, selectedThreadId]);

  // Detect new inbound customer message:
  // • Always reset send-guards so the new AI draft can auto-load
  // • If draft is unedited → clear compose box (a fresh draft will arrive from generate-draft-unified)
  // • If draft was edited by the agent → show stale-draft banner so they know context changed
  const prevInboundCountRef = useRef({});
  useEffect(() => {
    if (!selectedThreadId) return;
    const prev = prevInboundCountRef.current[selectedThreadId] ?? null;
    const curr = inboundMessageCount;
    // Guard: when switching threads, message data can temporarily resolve to 0 before
    // the thread messages rehydrate. Ignore that transient 0 so we don't interpret
    // the subsequent restore (0 -> N) as a brand-new inbound email.
    if (prev !== null && prev > 0 && curr === 0) return;
    if (prev === null) {
      // First stable baseline for this thread in this session.
      if (curr === 0) return;
      prevInboundCountRef.current[selectedThreadId] = curr;
      return;
    }
    if (curr <= prev) {
      prevInboundCountRef.current[selectedThreadId] = curr;
      return; // no new message
    }
    prevInboundCountRef.current[selectedThreadId] = curr;

    // Reset guards set by handleSendDraft that would otherwise block new AI drafts.
    // Must happen regardless of whether the compose box has content.
    delete draftLastSavedRef.current[selectedThreadId];
    setSuppressAutoDraftByThread((p) => {
      if (!p[selectedThreadId]) return p;
      const next = { ...p };
      delete next[selectedThreadId];
      return next;
    });
    // Refresh API data so the new AI draft from generate-draft-unified is picked up
    refreshSelectedThreadMessagesRef.current?.().catch(() => null);

    const currentDraftText = draftValueRef.current;
    if (!currentDraftText) return; // compose box already empty, nothing more to do
    const isUnedited = systemDraftUneditedRef.current[selectedThreadId];
    if (isUnedited) {
      // Unedited system draft → clear immediately; generate-draft-unified will repopulate
      setDraftValue("");
      setDraftValueByThread((p) => ({ ...p, [selectedThreadId]: "" }));
      setSystemDraftUneditedByThread((p) => ({
        ...p,
        [selectedThreadId]: false,
      }));
    } else {
      // Agent was editing → warn without destroying their work
      setStaleDraftByThread((p) => ({ ...p, [selectedThreadId]: true }));
    }
  }, [inboundMessageCount, selectedThreadId, refreshSelectedThreadMessagesRef]);

  // Clear stale banner + compose when switching threads
  useEffect(() => {
    if (!selectedThreadId) return;
    setStaleDraftByThread((p) => {
      if (!p[selectedThreadId]) return p;
      const next = { ...p };
      delete next[selectedThreadId];
      return next;
    });
  }, [selectedThreadId]);

  const handleGenerateDraft = useCallback(
    async (replyLanguage) => {
      if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
      if (manualDraftGeneratingByThread[selectedThreadId]) return;
      const threadId = selectedThreadId;

      setManualDraftGeneratingByThread((prev) => ({
        ...prev,
        [threadId]: true,
      }));
      setDraftWaitTimedOutByThread((prev) => ({
        ...prev,
        [threadId]: false,
      }));
      setSuppressAutoDraftByThread((prev) => {
        if (!prev[threadId]) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });

      try {
        const res = await fetch(`/api/threads/${threadId}/generate-draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            replyLanguage ? { reply_language: replyLanguage } : {},
          ),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Could not generate draft.");
        }

        const signature = String(payload?.signature || "");
        if (signature) {
          setSignatureByThread((prev) => ({
            ...prev,
            [threadId]: signature,
          }));
        }

        const draft = payload?.draft || null;
        const proposalOnly = payload?.proposal_only === true;
        setProposalOnlyByThread((prev) => ({
          ...prev,
          [threadId]: proposalOnly,
        }));
        if (proposalOnly && !draft) {
          const approvalRes = await fetch(
            `/api/threads/${encodeURIComponent(threadId)}/order-updates/accept`,
            { method: "GET" },
          ).catch(() => null);
          const approvalPayload = approvalRes?.ok
            ? await approvalRes.json().catch(() => ({}))
            : {};
          const latestAction = approvalPayload?.action || null;
          const latestReturnCase =
            approvalPayload?.returnCase &&
            typeof approvalPayload.returnCase === "object"
              ? approvalPayload.returnCase
              : null;
          if (latestReturnCase) {
            setReturnCaseByThread((prev) => ({
              ...prev,
              [threadId]: latestReturnCase,
            }));
          }
          if (latestAction) {
            const normalizedStatus = String(
              latestAction.normalizedStatus || latestAction.status || "",
            ).toLowerCase();
            const actionType = asString(
              latestAction.actionType || latestAction.action_type,
            ).toLowerCase();
            const actionPayload =
              latestAction?.payload && typeof latestAction.payload === "object"
                ? latestAction.payload
                : {};
            const isTestModeAction =
              latestAction?.testMode === true ||
              normalizedStatus === "approved_test_mode" ||
              actionPayload?.test_mode === true ||
              actionPayload?.simulated === true;
            const isFailedStatus = normalizedStatus === "failed";
            const actionDetail = isFailedStatus
              ? asString(latestAction?.error) ||
                asString(latestAction?.detail) ||
                "Order action could not be completed."
              : asString(latestAction?.detail) ||
                "Sona wants to apply an order update for this customer.";
            setPendingOrderUpdateByThread((prev) => ({
              ...prev,
              [threadId]: {
                id: String(latestAction.id || ""),
                detail: actionDetail,
                actionType: actionType || null,
                payload: actionPayload,
                createdAt: latestAction.createdAt || null,
                updatedAt:
                  latestAction.updatedAt || latestAction.createdAt || null,
                status:
                  asString(
                    latestAction.status || latestAction.normalizedStatus,
                  ) || "pending",
                testMode: isTestModeAction,
                approvedBy: asString(latestAction.approvedBy) || "",
                error: isFailedStatus
                  ? asString(latestAction.error) || actionDetail
                  : null,
              },
            }));
            const decisionFromAction = getDecisionFromActionStatus(
              latestAction.status,
            );
            setOrderUpdateDecisionByThread((prev) => {
              const next = { ...prev };
              if (decisionFromAction) next[threadId] = decisionFromAction;
              else delete next[threadId];
              return next;
            });
          }
          setSuppressAutoDraftByThread((prev) => ({
            ...prev,
            [threadId]: true,
          }));
          if (selectedThreadIdRef.current === threadId) {
            setDraftValue("");
          }
          setDraftValueByThread((prev) => ({
            ...prev,
            [threadId]: "",
          }));
          if (selectedThreadIdRef.current === threadId) {
            draftValueRef.current = "";
          }
          draftLastSavedRef.current[threadId] = "";
          setSystemDraftUneditedByThread((prev) => ({
            ...prev,
            [threadId]: false,
          }));
          if (selectedThreadIdRef.current === threadId) {
            setActiveDraftId(null);
          }
          toast.success("Action proposal created and is awaiting approval.");
          return;
        }
        setSuppressAutoDraftByThread((prev) => {
          if (!prev[threadId]) return prev;
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
        const draftText = draft?.body_text || draft?.body_html || "";
        if (draftText) {
          if (selectedThreadIdRef.current === threadId) {
            setDraftValue(draftText);
          }
          setDraftValueByThread((prev) => ({
            ...prev,
            [threadId]: draftText,
          }));
          if (selectedThreadIdRef.current === threadId) {
            draftValueRef.current = draftText;
          }
          setSystemDraftUneditedByThread((prev) => ({
            ...prev,
            [threadId]: true,
          }));
          setStaleDraftByThread((prev) => {
            if (!prev[threadId]) return prev;
            const next = { ...prev };
            delete next[threadId];
            return next;
          });
          if (draft?.id && selectedThreadIdRef.current === threadId) {
            setActiveDraftId(draft.id);
          }
          // Persist generated draft immediately so a quick thread switch cannot lose it.
          try {
            const subject =
              derivedThreads.find(
                (thread) => String(thread?.id || "").trim() === threadId,
              )?.subject || "";
            const persistRes = await fetch(`/api/threads/${threadId}/draft`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                body_text: draftText,
                subject,
              }),
            });
            const persistPayload = await persistRes.json().catch(() => ({}));
            if (persistRes?.ok) {
              draftLastSavedRef.current[threadId] = draftText.trim();
              if (
                persistPayload?.draft_id &&
                selectedThreadIdRef.current === threadId
              ) {
                setActiveDraftId(persistPayload.draft_id);
              }
            } else {
              draftLastSavedRef.current[threadId] = "";
            }
          } catch {
            draftLastSavedRef.current[threadId] = "";
          }
          toast.success("Draft generated.");
          // Refresh tags after a short delay to let fire-and-forget auto-tagging complete
          setTimeout(() => {
            setTagsRefreshTriggerByThread((prev) => ({
              ...prev,
              [threadId]: (prev[threadId] || 0) + 1,
            }));
          }, 3000);
        } else if (payload?.skipped) {
          throw new Error(
            payload?.explanation ||
              payload?.reason ||
              "Draft generation was skipped.",
          );
        } else {
          throw new Error("Draft generation returned no content.");
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not generate draft.",
        );
      } finally {
        setManualDraftGeneratingByThread((prev) => {
          if (!prev[threadId]) return prev;
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedThreadIdRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
    [
      derivedThreads,
      isLocalThreadId,
      manualDraftGeneratingByThread,
      selectedThreadId,
      asString,
      getDecisionFromActionStatus,
    ],
  );

  const handleRefineDraft = useCallback(
    async (userPrompt, snippetIds = []) => {
      if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
      if (refineDraftLoadingByThread[selectedThreadId]) return;
      const threadId = selectedThreadId;

      setRefineDraftLoadingByThread((prev) => ({ ...prev, [threadId]: true }));

      const currentDraft = String(draftValueByThread?.[threadId] || "").trim();
      if (!userPrompt) {
        setRefineDraftLoadingByThread((prev) => ({
          ...prev,
          [threadId]: false,
        }));
        return;
      }

      try {
        let refined = "";
        if (currentDraft) {
          const res = await fetch(`/api/threads/${threadId}/refine-draft`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentDraft,
              userPrompt,
              snippetIds: Array.isArray(snippetIds) ? snippetIds : [],
            }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok)
            throw new Error(payload?.error || "Could not refine draft.");
          refined = String(payload?.draft || "").trim();
        } else {
          const res = await fetch(`/api/threads/${threadId}/generate-draft`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_instruction: userPrompt }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok)
            throw new Error(payload?.error || "Could not generate draft.");
          refined = String(
            payload?.draft?.body_text ||
              payload?.draft?.rendered_body_text ||
              "",
          ).trim();
        }
        if (refined) {
          if (selectedThreadIdRef.current === threadId) {
            setDraftValue(refined);
          }
          setDraftValueByThread((prev) => ({ ...prev, [threadId]: refined }));
        }
      } catch (err) {
        console.error("[handleRefineDraft]", err);
        toast.error(
          err instanceof Error ? err.message : "Could not refine draft.",
        );
      } finally {
        setRefineDraftLoadingByThread((prev) => {
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedThreadIdRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
    [
      selectedThreadId,
      isLocalThreadId,
      refineDraftLoadingByThread,
      draftValueByThread,
    ],
  );

  const handleDraftChange = useCallback(
    (nextValue, threadIdOverride = null) => {
      const targetThreadId = String(
        threadIdOverride || selectedThreadId || "",
      ).trim();
      if (!targetThreadId) return;
      if (composerMode === "note") {
        setNoteValueByThread((prev) => ({
          ...prev,
          [targetThreadId]: String(nextValue || ""),
        }));
        return;
      }
      if (selectedThreadIdRef.current === targetThreadId) {
        setDraftValue(String(nextValue || ""));
      }
      setDraftValueByThread((prev) => ({
        ...prev,
        [targetThreadId]: String(nextValue || ""),
      }));
      setSystemDraftUneditedByThread((prev) => {
        if (!prev[targetThreadId]) return prev;
        return {
          ...prev,
          [targetThreadId]: false,
        };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedThreadIdRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
    [composerMode, selectedThreadId],
  );

  const saveThreadDraft = useCallback(
    async ({ immediate = false, valueOverride, threadIdOverride } = {}) => {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const getDurationMs = () =>
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
      const threadId = String(
        threadIdOverride || selectedThreadId || "",
      ).trim();
      if (!threadId) return;
      if (isLocalThreadId(threadId)) return;
      if (composerMode === "note") return;
      if (!draftReady) return;
      const fallbackValue =
        threadId === selectedThreadIdRef.current
          ? draftValueRef.current
          : draftValueByThread[threadId] || "";
      const text = String(valueOverride ?? fallbackValue ?? "");
      const trimmed = text.trim();
      if (!trimmed) {
        const hasKnownServerDraft =
          Boolean(String(draftLastSavedRef.current[threadId] || "").trim()) ||
          (threadId === selectedThreadIdRef.current && Boolean(activeDraftId));
        if (!hasKnownServerDraft) {
          if (selectedThreadIdRef.current === threadId) {
            setActiveDraftId(null);
            setDraftValue("");
          }
          setDraftValueByThread((prev) =>
            prev?.[threadId] === "" ? prev : { ...prev, [threadId]: "" },
          );
          setSystemDraftUneditedByThread((prev) =>
            prev?.[threadId] === false ? prev : { ...prev, [threadId]: false },
          );
          draftLastSavedRef.current[threadId] = "";
          return;
        }
        if (!immediate || savingDraftThreadIdsRef.current.has(threadId)) return;
        savingDraftThreadIdsRef.current.add(threadId);
        let deleteSucceeded = false;
        try {
          const res = await fetch(`/api/threads/${threadId}/draft`, {
            method: "DELETE",
          });
          deleteSucceeded = Boolean(res?.ok);
        } catch {
          // ignore delete draft errors in UI flow
        } finally {
          savingDraftThreadIdsRef.current.delete(threadId);
        }
        if (selectedThreadIdRef.current === threadId) {
          setActiveDraftId(null);
          setDraftValue("");
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [threadId]: "",
        }));
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [threadId]: false,
        }));
        draftLastSavedRef.current[threadId] = "";
        setSuppressAutoDraftByThread((prev) => ({
          ...prev,
          [threadId]: true,
        }));
        if (deleteSucceeded && threadId === selectedThreadIdRef.current) {
          refreshSelectedThreadMessages?.().catch(() => null);
        }
        if (deleteSucceeded) {
          reportClientEvent({
            event: "draft_saved",
            threadId,
            status: "deleted",
            durationMs: getDurationMs(),
          });
        }
        return;
      }
      if (trimmed === String(draftLastSavedRef.current[threadId] || ""))
        return;
      if (savingDraftThreadIdsRef.current.has(threadId)) return;
      savingDraftThreadIdsRef.current.add(threadId);
      try {
        const subject =
          derivedThreads.find(
            (thread) => String(thread?.id || "").trim() === threadId,
          )?.subject || "";
        const res = await fetch(`/api/threads/${threadId}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body_text: text,
            subject,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Could not save draft.");
        }
        draftLastSavedRef.current[threadId] = trimmed;
        reportClientEvent({
          event: "draft_saved",
          threadId,
          status: "saved",
          durationMs: getDurationMs(),
        });
        if (data?.draft_id && selectedThreadIdRef.current === threadId) {
          setActiveDraftId(data.draft_id);
        }
      } catch {
        reportClientEvent({
          event: "draft_saved",
          threadId,
          status: "error",
          durationMs: getDurationMs(),
        });
        // keep UI responsive; autosave retries on next change/interval
      } finally {
        savingDraftThreadIdsRef.current.delete(threadId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedThreadIdRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
    [
      activeDraftId,
      composerMode,
      draftReady,
      draftValueByThread,
      derivedThreads,
      isLocalThreadId,
      selectedThreadId,
      refreshSelectedThreadMessages,
    ],
  );

  // Auto-save tick fires every 4s. THREAD-SWITCH SAFETY INVARIANT:
  //
  // It looks like this could race with a thread switch (tick fires mid-switch
  // and saves the new thread's content to the old thread's URL), but it can't:
  //
  // 1. `saveThreadDraft` is in deps, and the callback depends on `selectedThreadId`.
  //    When the user switches threads, useCallback re-creates `saveThreadDraft`
  //    with the new threadId, which triggers this effect to re-run — cleanup
  //    clears the old interval before a new one starts.
  // 2. `draftValueRef.current` is updated by a separate effect that runs AFTER
  //    React commits. So during a single tick, the interval callback's
  //    `saveThreadDraft` closure and `draftValueRef.current` are guaranteed to
  //    reference the SAME thread's state — both are one React-commit cycle
  //    behind, but they're behind by the same amount.
  // 3. `saveThreadDraft` itself derives `threadId` from `selectedThreadId` (its
  //    closure), and the POST URL uses that threadId — never `draftValueRef`.
  //
  // Don't "fix" by adding selectedThreadIdRef.current checks inside the tick:
  // doing that would actually CREATE a race where the ref (synchronous) and
  // the closure (one commit behind) disagree. — 2026-05-26
  useEffect(() => {
    if (isLocalThreadId(selectedThreadId)) return;
    if (!selectedThreadId || !draftReady) return;
    const timer = setInterval(() => {
      saveThreadDraft({
        immediate: false,
        valueOverride: draftValueRef.current,
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [draftReady, isLocalThreadId, saveThreadDraft, selectedThreadId]);

  // Draft-generation-timeout watchdog is intentionally NOT owned here — it lives
  // in InboxSplitView.jsx because it depends on latestMessageIsInbound/
  // hasDraftContentReady/isWaitingForApproval, which are derived from both
  // composer state (draftValue/aiDraft/draftMessage) AND thread-actions state
  // (pendingOrderUpdateByThread/orderUpdateDecisionByThread) in a way that's
  // cheaper to leave as a plain effect at the call site than to thread every
  // dependency through both hooks.

  // Not wrapped in useCallback — matches the pre-extraction shape (a plain async
  // function recreated each render). It is only ever used as a JSX prop
  // (`onSend={handleSendDraft}`), never as a dependency in another hook's deps
  // array, so recreation on every render is behavior-neutral.
  const handleSendDraft = async (payload = {}) => {
    const { onSent } = payload || {};
    if (isSending) return;
    if (!selectedThreadId) {
      toast.error("No thread selected.");
      return;
    }
    if (isLocalThreadId(selectedThreadId)) {
      toast.error("Saving/sending brand new tickets is not ready yet.");
      return;
    }
    const composeMode =
      payload?.mode === "note" || composerMode === "note"
        ? "note"
        : payload?.mode === "forward" || composerMode === "forward"
          ? "forward"
          : "reply";
    const composeBody = String(
      composeMode === "note" ? activeNoteValue : draftValue || "",
    );
    if (!composeBody.trim()) {
      toast.error("Draft is empty.");
      return;
    }
    const sendStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    sendingStartedAtRef.current = Date.now();
    setIsSending(true);
    const toastId = toast.loading(
      composeMode === "note"
        ? "Saving note..."
        : composeMode === "forward"
          ? "Forwarding email..."
          : "Sending draft...",
    );
    try {
      if (composeMode === "note") {
        const res = await fetch(`/api/threads/${selectedThreadId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body_text: composeBody,
            mention_user_ids: Array.isArray(payload?.mentionUserIds)
              ? payload.mentionUserIds.filter((value) => isUuid(value))
              : [],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Could not save internal note.");
        }
        const nowIso = new Date().toISOString();
        const noteMessage = data?.message
          ? data.message
          : {
              id: `local-note-${Date.now()}`,
              provider_message_id: `internal-note:local-${Date.now()}`,
              thread_id: selectedThreadId,
              user_id: currentSupabaseUserId || null,
              from_name: currentUserName,
              from_email: null,
              from_me: true,
              body_text: composeBody,
              body_html: null,
              is_read: true,
              is_draft: false,
              sent_at: null,
              received_at: null,
              created_at: nowIso,
            };
        setLocalSentMessagesByThread((prev) => ({
          ...prev,
          [selectedThreadId]: [...(prev[selectedThreadId] || []), noteMessage],
        }));
        toast.success("Internal note saved.", { id: toastId });
        reportClientEvent({
          event: "send_completed",
          threadId: selectedThreadId,
          status: "note",
          durationMs:
            (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            sendStartedAt,
        });
        setNoteValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: "",
        }));
        return;
      }

      const rawAttachments = Array.isArray(payload?.attachments)
        ? payload.attachments
        : [];
      const serializedAttachments = await Promise.all(
        rawAttachments.map(async (file) => {
          if (!file || typeof file.arrayBuffer !== "function") return null;
          const name = String(file.name || "").trim() || "attachment";
          const mimeType =
            String(file.type || "").trim() || "application/octet-stream";
          const sizeBytes = Number(file.size || 0);
          if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
          if (sizeBytes > 15 * 1024 * 1024) {
            throw new Error(`Attachment "${name}" is larger than 15 MB.`);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const chunkSize = 0x8000;
          let binary = "";
          for (let index = 0; index < bytes.length; index += chunkSize) {
            const chunk = bytes.subarray(
              index,
              Math.min(index + chunkSize, bytes.length),
            );
            binary += String.fromCharCode(...chunk);
          }
          const contentBase64 = btoa(binary);
          const deliveryMode =
            String(file?.__innoDeliveryMode || "")
              .trim()
              .toLowerCase() === "inline"
              ? "inline"
              : "attachment";
          const normalizedContentId = String(file?.__innoContentId || "")
            .trim()
            .replace(/^cid:/i, "")
            .replace(/[^A-Za-z0-9._@-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 120);
          return {
            filename: name,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            content_base64: contentBase64,
            is_inline: deliveryMode === "inline",
            content_id:
              deliveryMode === "inline" ? normalizedContentId || null : null,
          };
        }),
      );
      const attachmentsPayload = serializedAttachments.filter(Boolean);

      const res = await fetch(`/api/threads/${selectedThreadId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: composeBody,
          to_emails: payload.toRecipients,
          cc_emails: payload.ccRecipients,
          bcc_emails: payload.bccRecipients,
          attachments: attachmentsPayload,
          sender_name: currentUserName,
          draft_message_id: draftMessage?.id || activeDraftId || null,
          draft_preview_id: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not send reply.");
      }
      // Set edit badge directly from send response — no separate DB query needed
      if (data?.edit_classification && selectedThreadId) {
        setSentDraftStatsByThread((prev) => ({
          ...prev,
          [selectedThreadId]: {
            edit_classification: data.edit_classification,
            edit_delta_pct: data.edit_delta_pct ?? null,
          },
        }));
      }
      const nowIso = new Date().toISOString();
      const localMessageId = data?.message_id || `local-sent-${Date.now()}`;
      const localBodyText = String(data?.body_text || composeBody || "");
      const localCleanBodyText = String(
        data?.clean_body_text || localBodyText || "",
      );
      const fallbackLocalBodyHtml = String(localCleanBodyText || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\[cid:([^\]]+)\]/gi, (_match, rawCid = "") => {
          const normalizedCid = String(rawCid || "")
            .trim()
            .replace(/^cid:/i, "")
            .replace(/[^A-Za-z0-9._@-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 120);
          return normalizedCid
            ? `<img src="cid:${normalizedCid}" alt="Inline image">`
            : "";
        })
        .replace(/\n/g, "<br/>");
      const localBodyHtml =
        String(data?.body_html || "").trim() || fallbackLocalBodyHtml;
      const localCleanBodyHtml =
        String(data?.clean_body_html || "").trim() || fallbackLocalBodyHtml;
      const redirectedTo =
        data?.redirected_to && typeof data.redirected_to === "string"
          ? [String(data.redirected_to)]
          : null;
      const localTo = redirectedTo || payload.toRecipients || [];
      const localCc = redirectedTo ? [] : payload.ccRecipients || [];
      const localBcc = redirectedTo ? [] : payload.bccRecipients || [];
      setLocalSentMessagesByThread((prev) => ({
        ...prev,
        [selectedThreadId]: [
          ...(prev[selectedThreadId] || []),
          {
            id: localMessageId,
            thread_id: selectedThreadId,
            user_id: currentSupabaseUserId || null,
            from_name: currentUserName,
            from_email: mailboxEmails[0] || "",
            from_me: true,
            to_emails: localTo,
            cc_emails: localCc,
            bcc_emails: localBcc,
            body_text: localBodyText,
            body_html: localBodyHtml,
            clean_body_text: localCleanBodyText,
            clean_body_html: localCleanBodyHtml,
            is_read: true,
            sent_at: nowIso,
            received_at: null,
            created_at: nowIso,
            attachments: attachmentsPayload.map((attachment, index) => ({
              id: `local-attachment-${Date.now()}-${index}`,
              message_id: localMessageId,
              provider_attachment_id: attachment?.is_inline
                ? attachment?.content_id || null
                : null,
              filename: attachment.filename,
              mime_type: attachment.mime_type,
              size_bytes: attachment.size_bytes,
              content_base64: attachment.content_base64,
            })),
          },
        ],
      }));
      const providerId = data?.provider_message_id
        ? ` (${data.provider_message_id})`
        : "";
      if (data?.simulated) {
        toast.success(
          data?.message ||
            "Email simulated: Test Mode is enabled and no Test Email Address is configured.",
          { id: toastId },
        );
      } else if (data?.test_mode && data?.redirected_to) {
        toast.success(
          `Reply sent to ${data.redirected_to} (Test Mode).${providerId}`,
          {
            id: toastId,
          },
        );
      } else {
        toast.success(
          composeMode === "forward"
            ? `Forward sent${providerId}.`
            : `Reply sent${providerId}.`,
          { id: toastId },
        );
      }
      if (composeMode !== "note") {
        setTicketStateByThread((prev) => ({
          ...prev,
          [selectedThreadId]: {
            ...(prev[selectedThreadId] || DEFAULT_TICKET_STATE),
            status: "Pending",
          },
        }));
        setLiveThreads((prev) =>
          (prev || []).map((thread) =>
            thread?.id === selectedThreadId
              ? { ...thread, status: "pending", updated_at: nowIso }
              : thread,
          ),
        );
        fetch("/api/inbox/thread-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: selectedThreadId,
            status: "Pending",
          }),
        }).catch(() => null);
      }
      if (selectedThreadIdRef.current === selectedThreadId) {
        setDraftValue("");
      }
      setDraftValueByThread((prev) => ({
        ...prev,
        [selectedThreadId]: "",
      }));
      setActiveDraftId(null);
      draftLastSavedRef.current[selectedThreadId] = "";
      setSystemDraftUneditedByThread((prev) => ({
        ...prev,
        [selectedThreadId]: false,
      }));
      setSuppressAutoDraftByThread((prev) => ({
        ...prev,
        [selectedThreadId]: true,
      }));
      reportClientEvent({
        event: "send_completed",
        threadId: selectedThreadId,
        status: composeMode,
        durationMs:
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          sendStartedAt,
      });
      // Wired to selectNext() in queue views (Task 10, Plan 2) — see file
      // header comment.
      if (typeof onSent === "function") onSent();
    } catch (err) {
      reportClientEvent({
        event: "send_completed",
        threadId: selectedThreadId,
        status: "error",
        errorCode: err?.message || "unknown",
        durationMs:
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          sendStartedAt,
      });
      toast.error(err?.message || "Could not send draft.", { id: toastId });
    } finally {
      const elapsed = Date.now() - (sendingStartedAtRef.current || 0);
      const delay = Math.max(0, 600 - elapsed);
      if (delay) {
        setTimeout(() => setIsSending(false), delay);
      } else {
        setIsSending(false);
      }
    }
  };

  return {
    composerMode,
    setComposerMode,
    draftValue,
    setDraftValue,
    draftValueByThread,
    setDraftValueByThread,
    noteValueByThread,
    setNoteValueByThread,
    setSignatureByThread,
    activeDraftId,
    setActiveDraftId,
    isSending,
    setIsSending,
    suppressAutoDraftByThread,
    setSuppressAutoDraftByThread,
    proposalOnlyByThread,
    setProposalOnlyByThread,
    draftReady,
    setDraftReady,
    draftWaitTimedOutByThread,
    setDraftWaitTimedOutByThread,
    systemDraftUneditedByThread,
    setSystemDraftUneditedByThread,
    manualDraftGeneratingByThread,
    setManualDraftGeneratingByThread,
    postApprovalDraftLoadingByThread,
    setPostApprovalDraftLoadingByThread,
    refineDraftLoadingByThread,
    setRefineDraftLoadingByThread,
    tagsRefreshTriggerByThread,
    setTagsRefreshTriggerByThread,
    staleDraftByThread,
    setStaleDraftByThread,
    draftLogId,
    setDraftLogId,
    draftLogLoading,
    setDraftLogLoading,
    draftLogIdByThread,
    setDraftLogIdByThread,
    sendingStartedAtRef,
    draftLastSavedRef,
    savingDraftThreadIdsRef,
    draftValueRef,
    activeNoteValue,
    composerValue,
    handleGenerateDraft,
    handleRefineDraft,
    handleDraftChange,
    saveThreadDraft,
    handleSendDraft,
  };
}
