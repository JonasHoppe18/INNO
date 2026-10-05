const CLIENT_PARAMS = new Set(["view", "tab", "thread"]);

export function canNavigateQueueLocally(currentHref, href, event = {}) {
  if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (typeof href !== "string") return false;
  const current = new URL(currentHref);
  const next = new URL(href, current);
  return current.pathname === "/inbox" && next.pathname === "/inbox" && current.origin === next.origin &&
    [...current.searchParams.keys(), ...next.searchParams.keys()].every(key => CLIENT_PARAMS.has(key));
}
