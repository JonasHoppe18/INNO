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
