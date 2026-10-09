// The designer shows two separate facts: whether customers get the latest
// design (publish) and whether the latest edits are stored (save).
export function designerStatus({ draft, dirty = false, saving = false }) {
  const live = Boolean(draft?.id) && draft?.status === "published" && !dirty;
  const everPublished = draft?.published_version != null;
  const publish = live
    ? { label: "Published", tone: "published" }
    : everPublished
      ? { label: "Unpublished changes", tone: "pending" }
      : { label: "Not published", tone: "draft" };
  return {
    publish,
    save: saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved",
    canPublish: Boolean(draft) && !live,
  };
}

// CSAT needs exactly one rating block; confirmation designs may drop the legacy
// message block but never hold two.
export function requiredBlockProblem(count, { optional = false } = {}) {
  if (optional) return count > 1 ? "Keep at most one message block in the email." : "";
  if (count === 1) return "";
  return count === 0
    ? "Add one required message block before publishing."
    : "Keep one required message block in the email. Remove the extra required blocks before publishing.";
}
