"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toLegacyUiStatus } from "@/lib/inbox/status-model";
import { isOutboundMessage } from "@/components/inbox/inbox-utils";
import { normalizeActionDeclineInput } from "@/lib/action-decline";

// Matches InboxSplitView.jsx's local `normalizeStatus` wrapper exactly.
const normalizeStatus = (value) => toLegacyUiStatus(value);

// Verbatim extraction from InboxSplitView.jsx (Task 5, Plan 2). Behavior-preserving —
// see .superpowers/sdd/task-5-report.md for the mapping of what moved from where.
//
// Owns the approvals / order-update / return-case / ticket-state "optimistic UI"
// cluster:
//   - ticketStateByThread (+ the pendingUpdateThreadIds in-flight-PATCH guard ref)
//     and the effect that syncs it from the server-derived thread list.
//   - pendingOrderUpdateByThread, returnCaseByThread, orderUpdateDecisionByThread,
//     orderUpdateSubmittingByThread, orderUpdateErrorByThread, and the effects that
//     hydrate/clear them (detail-fetch hydration, secondary poll fetch, and the
//     auto-supersede-on-new-inbound-message effect).
//   - markReturnReceivedLoadingByThread and refreshPendingActionByThread (the
//     manual refresh-trigger counter consumed by the secondary poll effect).
//   - The handlers that mutate this state: handleTicketStateChange,
//     handleMarkReturnReceived, and handleOrderUpdateDecision (which also owns
//     the follow-up-action branch — e.g. "process return in Shopify" after an
//     exchange approval — since that's part of the same approve/deny flow, not a
//     separate subsystem).
export function useThreadActions({
  // Data this hook reads but does not own (owned by InboxSplitView.jsx or by
  // sibling hooks called there — passed in as plain values/refs, same pattern
  // Task 4's useThreadSelection used for isLocalThreadId/currentSupabaseUserId/etc).
  //
  // ticketStateByThread/setTicketStateByThread/pendingUpdateThreadIds are
  // declared in InboxSplitView.jsx itself (not owned here) purely because of a
  // render-order constraint: filteredThreads (computed in InboxSplitView.jsx)
  // reads ticketStateByThread to resolve each thread's effective status, and
  // useThreadSelection/useThreadMessages (whose return values this hook needs —
  // selectedThreadId, selectedThreadDetail, threadMessages) are called AFTER
  // filteredThreads. So this hook cannot own that piece of state without
  // creating a circular hook-call order; it still owns the sync effect that
  // keeps it up to date (below) and the handler that mutates it
  // (handleTicketStateChange), just not the useState/useRef declarations.
  derivedThreads,
  ticketStateByThread,
  setTicketStateByThread,
  pendingUpdateThreadIds,
  // pendingOrderUpdateByThread/setPendingOrderUpdateByThread are likewise
  // declared in InboxSplitView.jsx (not owned here) — see this file's own
  // detailed comment above and InboxSplitView.jsx's declaration site. Same
  // render-order/circular-hook-call reasoning as ticketStateByThread: this
  // hook needs useComposerState's draft setters (setDraftValue etc.), and
  // useComposerState needs to read pendingOrderUpdateByThread synchronously
  // during render (its auto-draft effect), so neither hook can be called
  // strictly before the other unless this piece of state is hoisted.
  pendingOrderUpdateByThread,
  setPendingOrderUpdateByThread,
  // closePendingOverrideByThread/setClosePendingOverrideByThread are likewise
  // declared in InboxSplitView.jsx (not owned here) — see this file's own
  // detailed comment above and InboxSplitView.jsx's declaration site. Same
  // render-order/circular-hook-call reasoning as ticketStateByThread/
  // pendingOrderUpdateByThread: filteredThreads (computed in
  // InboxSplitView.jsx, before this hook is called) reads
  // closePendingOverrideByThread to compute effectiveClosePending, so this
  // hook cannot own that piece of state without creating a circular
  // hook-call order; it still owns the handlers that mutate it
  // (approveClose/keepWaiting via patchThreadStatusForCloseDecision), just
  // not the useState declaration.
  closePendingOverrideByThread,
  setClosePendingOverrideByThread,
  selectedThreadId,
  selectedThreadIdRef,
  selectedThreadDetail,
  messagesFetchedForThreadId,
  selectedThreadMessagesLoading,
  threadMessages,
  filteredThreads,
  isLocalThreadId,
  supabase,
  mailboxEmails,
  currentUserName,
  // Setters/refs owned by useThreadSelection — handleTicketStateChange advances
  // to the next visible thread when a ticket is resolved.
  setOpenThreadIds,
  setSelectedThreadId,
  // Composer setters/refs this hook's handlers need (draft state is owned by
  // useComposerState, but approving an order update can produce a fresh draft —
  // see loadGeneratedDraft inside handleOrderUpdateDecision — so those setters
  // are threaded through as parameters).
  setDraftValue,
  setDraftValueByThread,
  setSystemDraftUneditedByThread,
  setActiveDraftId,
  setSignatureByThread,
  setPostApprovalDraftLoadingByThread,
  draftValueRef,
  draftLastSavedRef,
  // Pure helpers owned by InboxSplitView.jsx (module-level, shared with code
  // that stays there, e.g. the selectedPendingOrderUpdate memo).
  asString,
  isApprovalManagedActionType,
  getDecisionFromActionStatus,
  DEFAULT_TICKET_STATE,
}) {
  const [returnCaseByThread, setReturnCaseByThread] = useState({});
  const [orderUpdateDecisionByThread, setOrderUpdateDecisionByThread] =
    useState({});
  const [orderUpdateSubmittingByThread, setOrderUpdateSubmittingByThread] =
    useState({});
  const [orderUpdateErrorByThread, setOrderUpdateErrorByThread] = useState({});
  const [
    markReturnReceivedLoadingByThread,
    setMarkReturnReceivedLoadingByThread,
  ] = useState({});
  const [refreshPendingActionByThread, setRefreshPendingActionByThread] =
    useState({});

  // Keep ticketStateByThread in sync with the server-derived thread list
  // (status/priority/assignee), unless a PATCH for that thread is still
  // in-flight (pendingUpdateThreadIds) — avoids clobbering an optimistic
  // update with stale server data that hasn't caught up yet.
  useEffect(() => {
    if (!derivedThreads.length) return;
    setTicketStateByThread((prev) => {
      let changed = false;
      const next = { ...prev };
      derivedThreads.forEach((thread) => {
        if (!thread?.id || isLocalThreadId(thread.id)) return;
        if (pendingUpdateThreadIds.current.has(thread.id)) return;
        const normalizedStatus = normalizeStatus(thread.status) || "New";
        const normalizedPriority =
          thread.priority ?? DEFAULT_TICKET_STATE.priority;
        const normalizedAssignee =
          thread.assignee_id ?? DEFAULT_TICKET_STATE.assignee;
        const existing = next[thread.id];
        if (
          existing &&
          existing.status === normalizedStatus &&
          existing.priority === normalizedPriority &&
          existing.assignee === normalizedAssignee
        ) {
          return;
        }
        next[thread.id] = {
          ...(existing || DEFAULT_TICKET_STATE),
          status: normalizedStatus,
          priority: normalizedPriority,
          assignee: normalizedAssignee,
        };
        changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingUpdateThreadIds is a bare useRef (stable identity forever) and setTicketStateByThread is a bare useState setter (stable identity forever), both passed in as parameters from InboxSplitView.jsx; omitting them matches pre-extraction behavior.
  }, [derivedThreads, isLocalThreadId, DEFAULT_TICKET_STATE]);

  // When the user switches threads, eagerly clear any cached pending-action
  // state for the new thread. Without this, a stale action card briefly
  // flashes from the previous fetch before the new detail-API response (which
  // correctly returns no action when superseded) overwrites it.
  useEffect(() => {
    if (!selectedThreadId) return;
    setPendingOrderUpdateByThread((prev) => {
      if (!prev[selectedThreadId]) return prev;
      const next = { ...prev };
      delete next[selectedThreadId];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPendingOrderUpdateByThread is a bare useState setter (stable identity forever), passed in as a parameter from InboxSplitView.jsx; omitting it matches pre-extraction behavior.
  }, [selectedThreadId]);

  // Detail-fetch effect: hydrate returnCaseByThread / pendingOrderUpdateByThread /
  // orderUpdateDecisionByThread from the thread detail payload once messages for
  // the selected thread have loaded.
  useEffect(() => {
    if (!selectedThreadId || messagesFetchedForThreadId !== selectedThreadId) return;
    if (!selectedThreadDetail || typeof selectedThreadDetail !== "object") return;

    const detailOrderUpdate = selectedThreadDetail.orderUpdate || null;
    const latestReturnCase = detailOrderUpdate?.returnCase || null;
    if (latestReturnCase) {
      setReturnCaseByThread((prev) => ({
        ...prev,
        [selectedThreadId]: latestReturnCase,
      }));
    }
    const latestAction = detailOrderUpdate?.action || null;
    // No actionable action on this thread — clear any stale pending state we
    // may have cached from a prior fetch. Without this, a "Cancel Order" card
    // that was superseded server-side would persist in the UI until reload.
    if (!latestAction) {
      setPendingOrderUpdateByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      setOrderUpdateDecisionByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      return;
    }

    const normalizedStatus = String(
      latestAction.normalizedStatus || latestAction.status || "",
    ).toLowerCase();
    const actionType = asString(latestAction.actionType || latestAction.action_type).toLowerCase();
    const actionPayload =
      latestAction?.payload && typeof latestAction.payload === "object"
        ? latestAction.payload
        : {};
    const shouldShowActionCardForType =
      isApprovalManagedActionType(actionType) ||
      normalizedStatus === "pending" ||
      normalizedStatus === "awaiting_approval" ||
      normalizedStatus === "requires_approval";
    // Action exists but isn't in an approval-needing state (e.g. completed,
    // failed, declined) — still clear pending state so the approval card
    // disappears once the action transitions.
    if (!shouldShowActionCardForType) {
      setPendingOrderUpdateByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      return;
    }

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
      [selectedThreadId]: {
        id: String(latestAction.id || ""),
        detail: actionDetail,
        actionType: actionType || null,
        payload: actionPayload,
        createdAt: latestAction.createdAt || null,
        updatedAt: latestAction.updatedAt || latestAction.createdAt || null,
        status:
          asString(latestAction.status || latestAction.normalizedStatus) ||
          "pending",
        testMode: isTestModeAction,
        approvedBy: asString(latestAction.approvedBy) || "",
        error: isFailedStatus
          ? asString(latestAction.error) || actionDetail
          : null,
      },
    }));
    const decisionFromAction = getDecisionFromActionStatus(latestAction.status);
    setOrderUpdateDecisionByThread((prev) => {
      const next = { ...prev };
      if (decisionFromAction) next[selectedThreadId] = decisionFromAction;
      else delete next[selectedThreadId];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftValueByThread is intentionally omitted: it's only read once for a "first-time-seeing-this-thread" guard. Including it in deps caused React error #185 (Maximum update depth exceeded) pre-extraction — every composer keystroke mutates draftValueByThread, which would re-run this effect and fire fresh-object-ref setStates on every keystroke. Preserved verbatim from InboxSplitView.jsx.
  }, [
    messagesFetchedForThreadId,
    selectedThreadDetail,
    selectedThreadId,
  ]);

  // Secondary fallback fetch of the pending order-update action, delayed so it
  // doesn't race the primary detail fetch above. Also the target of the manual
  // "refresh" trigger bumped by handleMarkReturnReceived.
  useEffect(() => {
    if (!selectedThreadId) return;
    if (isLocalThreadId(selectedThreadId)) return;
    if (
      selectedThreadMessagesLoading &&
      messagesFetchedForThreadId !== selectedThreadId
    )
      return;
    if (
      messagesFetchedForThreadId === selectedThreadId &&
      selectedThreadDetail?.orderUpdate
    )
      return;

    let active = true;
    const loadPendingOrderUpdate = async () => {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(selectedThreadId)}/order-updates/accept`,
        { method: "GET" },
      ).catch(() => null);
      if (!active) return;
      if (!res?.ok) return;
      const payload = await res.json().catch(() => ({}));
      if (!active) return;
      const latestAction = payload?.action || null;
      const latestReturnCase =
        payload?.returnCase && typeof payload.returnCase === "object"
          ? payload.returnCase
          : null;
      if (latestReturnCase) {
        setReturnCaseByThread((prev) => ({
          ...prev,
          [selectedThreadId]: latestReturnCase,
        }));
      } else {
        setReturnCaseByThread((prev) => {
          if (!prev[selectedThreadId]) return prev;
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
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
        const shouldShowActionCardForType =
          isApprovalManagedActionType(actionType) ||
          normalizedStatus === "pending" ||
          normalizedStatus === "awaiting_approval" ||
          normalizedStatus === "requires_approval";
        if (!shouldShowActionCardForType) {
          setPendingOrderUpdateByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
          setOrderUpdateDecisionByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
          setOrderUpdateErrorByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
          return;
        }
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
          [selectedThreadId]: {
            id: String(latestAction.id || ""),
            detail: actionDetail,
            actionType: actionType || null,
            payload: actionPayload,
            createdAt: latestAction.createdAt || null,
            updatedAt: latestAction.updatedAt || latestAction.createdAt || null,
            status:
              asString(latestAction.status || latestAction.normalizedStatus) ||
              "pending",
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
          if (decisionFromAction) next[selectedThreadId] = decisionFromAction;
          else delete next[selectedThreadId];
          return next;
        });
        setOrderUpdateErrorByThread((prev) => {
          const next = { ...prev };
          if (
            String(latestAction.status || "").toLowerCase() === "failed" &&
            latestAction.error
          ) {
            next[selectedThreadId] = String(latestAction.error);
          } else {
            delete next[selectedThreadId];
          }
          return next;
        });
        return;
      }
      setPendingOrderUpdateByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      setOrderUpdateDecisionByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      setOrderUpdateErrorByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
    };

    const timerId = setTimeout(() => {
      loadPendingOrderUpdate().catch(() => null);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asString/isApprovalManagedActionType/getDecisionFromActionStatus are module-level pure functions declared once in InboxSplitView.jsx and passed in as params; identity never changes across renders, so omitting them matches the pre-extraction behavior when this effect read them as in-scope module-level consts directly.
  }, [
    isLocalThreadId,
    messagesFetchedForThreadId,
    selectedThreadDetail,
    selectedThreadId,
    selectedThreadMessagesLoading,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- manual refresh trigger from mark-received
    refreshPendingActionByThread[selectedThreadId],
  ]);

  // Auto-supersede a pending action if a newer inbound message has arrived since it was created.
  // This handles cases where the customer resolved their issue before the agent approved the action.
  useEffect(() => {
    const pendingAction = pendingOrderUpdateByThread[selectedThreadId];
    if (!supabase || !selectedThreadId || !pendingAction?.id) return;
    if (pendingAction.status !== "pending") return;
    if (!pendingAction.createdAt) return;

    const actionTime = new Date(pendingAction.createdAt).getTime();
    if (!actionTime) return;

    const latestInboundTime = threadMessages
      .filter((m) => !isOutboundMessage(m, mailboxEmails))
      .reduce((max, m) => {
        const t = new Date(m.received_at || m.created_at || 0).getTime();
        return t > max ? t : max;
      }, 0);

    if (latestInboundTime <= actionTime) return;

    supabase
      .from("thread_actions")
      .update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("id", pendingAction.id)
      .then(({ error }) => {
        if (error) return;
        setPendingOrderUpdateByThread((prev) => {
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
        setOrderUpdateDecisionByThread((prev) => {
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPendingOrderUpdateByThread is a bare useState setter (stable identity forever), passed in as a parameter from InboxSplitView.jsx; omitting it matches pre-extraction behavior.
  }, [
    supabase,
    selectedThreadId,
    pendingOrderUpdateByThread,
    threadMessages,
    mailboxEmails,
  ]);

  const handleMarkReturnReceived = useCallback(async () => {
    if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
    if (markReturnReceivedLoadingByThread[selectedThreadId]) return;
    const threadId = selectedThreadId;
    setMarkReturnReceivedLoadingByThread((prev) => ({
      ...prev,
      [threadId]: true,
    }));
    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(threadId)}/exchange/mark-received`,
        { method: "POST" },
      ).catch(() => null);
      if (!res?.ok) return;
      // Trigger action re-fetch by bumping the refresh counter (re-uses existing loadPendingOrderUpdate)
      setRefreshPendingActionByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] || 0) + 1,
      }));
    } finally {
      setMarkReturnReceivedLoadingByThread((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
    }
  }, [selectedThreadId, isLocalThreadId, markReturnReceivedLoadingByThread]);

  const handleTicketStateChange = useCallback(
    (updates) => {
      if (!selectedThreadId) return;
      setTicketStateByThread((prev) => ({
        ...prev,
        [selectedThreadId]: {
          ...prev[selectedThreadId],
          ...updates,
        },
      }));

      // When a ticket is resolved/closed it disappears from the current view —
      // automatically advance to the next visible ticket instead of leaving an
      // orphaned selection with nothing highlighted in the list.
      if (updates.status === "resolved" || updates.status === "Solved") {
        // Trigger AI solution summary generation (fire-and-forget)
        fetch(
          `/api/threads/${encodeURIComponent(selectedThreadId)}/solution-summary`,
          {
            method: "POST",
          },
        ).catch(() => null);

        const currentIdx = filteredThreads.findIndex(
          (t) => t.id === selectedThreadId,
        );
        const nextThread =
          filteredThreads[currentIdx + 1] ||
          filteredThreads[currentIdx - 1] ||
          null;
        setOpenThreadIds((prev) => {
          const without = prev.filter((id) => id !== selectedThreadId);
          if (!nextThread) return without;
          return without.includes(nextThread.id)
            ? without
            : [nextThread.id, ...without];
        });
        setSelectedThreadId(nextThread?.id || null);
      }

      const payload = {};
      if (typeof updates.status === "string") {
        payload.status = updates.status;
      }
      if (typeof updates.priority === "string" || updates.priority === null) {
        payload.priority = updates.priority;
      }
      if (typeof updates.assignee === "string" || updates.assignee === null) {
        payload.assigneeId = updates.assignee;
      }
      if (!Object.keys(payload).length) return;

      const pendingThreadId = selectedThreadId;
      pendingUpdateThreadIds.current.add(pendingThreadId);
      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: pendingThreadId,
          ...payload,
        }),
      })
        .then(async (response) => {
          if (response.ok) return;
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Could not update ticket status.");
        })
        .catch((error) => {
          toast.error(error.message || "Could not update ticket status.");
        })
        .finally(() => {
          pendingUpdateThreadIds.current.delete(pendingThreadId);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpenThreadIds and setSelectedThreadId are the stable setters returned by useThreadSelection (backed by useState); identity never changes, so omitting them matches the pre-extraction behavior when they were local useState setters.
    [filteredThreads, selectedThreadId],
  );

  // Task 9, Plan 2: shared PATCH-based body for the "Approve close" group's
  // two row actions. Both approveClose and keepWaiting optimistically flip
  // closePendingOverrideByThread[threadId] to true (removing the row from the
  // Approve-close group immediately — see filteredThreads' close_pending read
  // in InboxSplitView.jsx) and revert (delete the override) on PATCH failure,
  // matching handleTicketStateChange/handleOrderUpdateDecision's existing
  // optimistic-update + toast-on-failure pattern in this file.
  const patchThreadStatusForCloseDecision = useCallback(
    (threadId, status, failureMessage) => {
      if (!threadId) return;
      setClosePendingOverrideByThread((prev) => ({
        ...prev,
        [threadId]: true,
      }));
      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, status }),
      })
        .then(async (response) => {
          if (response.ok) return;
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || failureMessage);
        })
        .catch((error) => {
          setClosePendingOverrideByThread((prev) => {
            const next = { ...prev };
            delete next[threadId];
            return next;
          });
          toast.error(error.message || failureMessage);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setClosePendingOverrideByThread is a bare useState setter (stable identity forever), passed in as a parameter from InboxSplitView.jsx; omitting it matches the established pattern for setPendingOrderUpdateByThread/setTicketStateByThread elsewhere in this file.
    [],
  );

  const approveClose = useCallback(
    (threadId) =>
      patchThreadStatusForCloseDecision(
        threadId,
        "resolved",
        "Could not approve close.",
      ),
    [patchThreadStatusForCloseDecision],
  );

  const keepWaiting = useCallback(
    (threadId) =>
      patchThreadStatusForCloseDecision(
        threadId,
        "waiting_customer",
        "Could not keep ticket waiting.",
      ),
    [patchThreadStatusForCloseDecision],
  );

  const handleOrderUpdateDecision = useCallback(
    async (decision, options = undefined) => {
      if (!selectedThreadId) return;
      const normalized = decision === "accepted" ? "accepted" : "denied";
      const pending = pendingOrderUpdateByThread[selectedThreadId];
      if (!pending) {
        toast.error("No pending order update found.");
        return;
      }

      if (orderUpdateSubmittingByThread[selectedThreadId]) return;
      setOrderUpdateSubmittingByThread((prev) => ({
        ...prev,
        [selectedThreadId]: true,
      }));
      setOrderUpdateErrorByThread((prev) => {
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      const toastId = toast.loading(
        normalized === "accepted" ? "Applying action..." : "Creating a new draft...",
      );
      const loadGeneratedDraft = async (threadId) => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const draftRes = await fetch(`/api/threads/${threadId}/draft`, {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          }).catch(() => null);
          if (draftRes?.ok) {
            const draftPayload = await draftRes.json().catch(() => ({}));
            const draft = draftPayload?.draft || null;
            const sig = String(draftPayload?.signature || "");
            const draftText =
              draft?.rendered_body_text ||
              draft?.body_text ||
              draft?.body_html ||
              "";
            if (draftText) {
              if (selectedThreadIdRef.current === threadId) {
                setDraftValue(draftText);
                draftValueRef.current = draftText;
              }
              draftLastSavedRef.current[threadId] = draftText.trim();
              setDraftValueByThread((prev) => ({
                ...prev,
                [threadId]: draftText,
              }));
              setSystemDraftUneditedByThread((prev) => ({
                ...prev,
                [threadId]: true,
              }));
              if (draft?.id && selectedThreadIdRef.current === threadId) {
                setActiveDraftId(draft.id);
              }
              if (sig) {
                setSignatureByThread((prev) => ({
                  ...prev,
                  [threadId]: sig,
                }));
              }
              return true;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 250));
        }
        return false;
      };
      try {
        const nowIso = new Date().toISOString();
        const declineContext = normalized === "denied"
          ? normalizeActionDeclineInput(options)
          : null;
        const pendingId = String(pending.id || "").trim();
        const pendingLooksLikeUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            pendingId,
          );
        const res = await fetch(
          `/api/threads/${selectedThreadId}/order-updates/accept`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decision: normalized === "accepted" ? "accepted" : "declined",
              actionId: pendingLooksLikeUuid ? pendingId : null,
              proposalLogId: pendingLooksLikeUuid ? null : pending.id || null,
              proposalText: pending.detail || "",
              ...(declineContext || {}),
              payloadOverride:
                normalized === "accepted" &&
                options &&
                typeof options === "object" &&
                Object.keys(options).length
                  ? options
                  : null,
            }),
          },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Could not update action.");
        }
        if (
          normalized === "accepted" &&
          (payload?.testMode || payload?.simulated)
        ) {
          const testModeMessage = String(
            payload?.message ||
              "Action approved, but no changes were made because Test Mode is enabled.",
          );
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(pending.id || ""),
              detail: testModeMessage,
              actionType: pending.actionType || null,
              payload:
                pending.payload && typeof pending.payload === "object"
                  ? pending.payload
                  : {},
              createdAt: pending.createdAt || null,
              updatedAt: payload?.approvedAt || nowIso,
              status: "approved_test_mode",
              testMode: true,
              approvedBy: currentUserName,
              error: null,
            },
          }));
        }
        if (payload?.blocked) {
          const blockedReason = String(
            payload?.reason ||
              "Action could not be applied because the order cannot be changed.",
          );
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(pending.id || ""),
              detail: blockedReason,
              actionType: pending.actionType || null,
              payload:
                pending.payload && typeof pending.payload === "object"
                  ? pending.payload
                  : {},
              createdAt: pending.createdAt || null,
              updatedAt: payload?.approvedAt || nowIso,
              status: "failed",
              testMode: false,
              error: blockedReason,
            },
          }));
          setOrderUpdateErrorByThread((prev) => ({
            ...prev,
            [selectedThreadId]: blockedReason,
          }));
          setOrderUpdateDecisionByThread((prev) => {
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });

          if (payload?.draftGenerated) {
            setPostApprovalDraftLoadingByThread((prev) => ({
              ...prev,
              [selectedThreadId]: true,
            }));
            await loadGeneratedDraft(selectedThreadId);
            setPostApprovalDraftLoadingByThread((prev) => ({
              ...prev,
              [selectedThreadId]: false,
            }));
          }

          toast.error(blockedReason, { id: toastId });
          return false;
        }
        if (payload?.returnCase && typeof payload.returnCase === "object") {
          setReturnCaseByThread((prev) => ({
            ...prev,
            [selectedThreadId]: payload.returnCase,
          }));
        }
        const followUp = payload?.followUpAction || null;
        if (
          followUp &&
          typeof followUp === "object" &&
          String(followUp?.status || "").toLowerCase() === "pending"
        ) {
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(followUp.id || ""),
              detail: asString(followUp.detail) || "Process return in Shopify.",
              actionType:
                asString(followUp.actionType || followUp.action_type) || null,
              payload:
                followUp?.payload && typeof followUp.payload === "object"
                  ? followUp.payload
                  : {},
              createdAt: followUp.createdAt || null,
              updatedAt: followUp.updatedAt || followUp.createdAt || null,
              status: "pending",
              testMode: false,
              error: null,
            },
          }));
          setOrderUpdateDecisionByThread((prev) => {
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
        } else {
          if (normalized === "accepted") {
            setPendingOrderUpdateByThread((prev) => ({
              ...prev,
              [selectedThreadId]: {
                ...pending,
                status:
                  payload?.testMode || payload?.simulated
                    ? "approved_test_mode"
                    : "applied",
                detail: asString(payload?.detail) || pending.detail || "",
                updatedAt: payload?.approvedAt || nowIso,
                approvedBy: currentUserName,
                testMode: Boolean(payload?.testMode || payload?.simulated),
                error: null,
              },
            }));
          }
          setOrderUpdateDecisionByThread((prev) => ({
            ...prev,
            [selectedThreadId]: normalized,
          }));
        }
        setOrderUpdateErrorByThread((prev) => {
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
        if (normalized === "accepted") {
          if (payload?.testMode || payload?.simulated) {
            toast.success(
              payload?.message ||
                "Action approved, but no changes were made because Test Mode is enabled.",
              { id: toastId },
            );
          } else {
            toast.success("Action approved and applied.", { id: toastId });
          }
          if (payload?.draftGenerated) {
            setPostApprovalDraftLoadingByThread((prev) => ({
              ...prev,
              [selectedThreadId]: true,
            }));
            await loadGeneratedDraft(selectedThreadId);
            setPostApprovalDraftLoadingByThread((prev) => ({
              ...prev,
              [selectedThreadId]: false,
            }));
          }
        } else {
          if (payload?.draftGenerated) {
            setPostApprovalDraftLoadingByThread((prev) => ({
              ...prev,
              [selectedThreadId]: true,
            }));
            await loadGeneratedDraft(selectedThreadId);
            setPostApprovalDraftLoadingByThread((prev) => ({
              ...prev,
              [selectedThreadId]: false,
            }));
          }
          toast.success(
            payload?.draftGenerated
              ? "Action declined and a new draft is ready."
              : "Action declined.",
            { id: toastId },
          );
        }
        return true;
      } catch (error) {
        const message = error?.message || "Could not update action.";
        setOrderUpdateErrorByThread((prev) => ({
          ...prev,
          [selectedThreadId]: message,
        }));
        toast.error(error?.message || "Could not update action.", {
          id: toastId,
        });
        return false;
      } finally {
        setOrderUpdateSubmittingByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
        setPostApprovalDraftLoadingByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedThreadIdRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
    [
      currentUserName,
      orderUpdateSubmittingByThread,
      pendingOrderUpdateByThread,
      selectedThreadId,
    ],
  );

  return {
    ticketStateByThread,
    setTicketStateByThread,
    pendingUpdateThreadIds,
    pendingOrderUpdateByThread,
    setPendingOrderUpdateByThread,
    returnCaseByThread,
    setReturnCaseByThread,
    orderUpdateDecisionByThread,
    setOrderUpdateDecisionByThread,
    orderUpdateSubmittingByThread,
    setOrderUpdateSubmittingByThread,
    orderUpdateErrorByThread,
    setOrderUpdateErrorByThread,
    markReturnReceivedLoadingByThread,
    setMarkReturnReceivedLoadingByThread,
    refreshPendingActionByThread,
    setRefreshPendingActionByThread,
    closePendingOverrideByThread,
    setClosePendingOverrideByThread,
    handleMarkReturnReceived,
    handleTicketStateChange,
    handleOrderUpdateDecision,
    approveClose,
    keepWaiting,
  };
}
