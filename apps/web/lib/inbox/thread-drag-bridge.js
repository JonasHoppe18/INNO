"use client";

// Bridge between the ticket list's draggable rows (rendered inside
// InboxSplitView) and the sidebar's inbox drop targets (in nav-queue.jsx,
// mounted from the dashboard layout). The two live in separate parts of the
// component tree with no shared props path, so — exactly like
// live-sidebar-counts.js — they coordinate through this module instead.
//
// Native HTML5 drag-and-drop only carries the threadId across the DOM (via
// dataTransfer). The actual move (optimistic tag update + PATCH + rollback)
// lives in InboxSplitView, which registers a handler here; the sidebar's drop
// handler looks it up and invokes it. A plain module-level function ref is
// enough — no React subscription needed, since the drop is a one-shot call,
// not reactive state the sidebar needs to render from.

export const THREAD_DRAG_MIME = "application/x-sona-thread-id";

let moveHandler = null;

// InboxSplitView calls this once (in an effect); returns an unregister fn.
export function registerThreadMoveHandler(fn) {
  moveHandler = typeof fn === "function" ? fn : null;
  return () => {
    if (moveHandler === fn) moveHandler = null;
  };
}

// destination: { inboxSlug: string | null, classificationKey: "support" | "notification" }
// Returns true if a handler was registered and invoked, false otherwise (e.g.
// the inbox isn't currently mounted, so there's nothing to move within).
export function dispatchThreadMove(threadId, destination) {
  const id = String(threadId || "").trim();
  if (!id || typeof moveHandler !== "function") return false;
  moveHandler(id, destination || {});
  return true;
}
