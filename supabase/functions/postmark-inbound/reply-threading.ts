// Postmark stores an outgoing email under its bare MessageID, but the email's
// Message-ID header (what customers' replies reference) is "<MessageID>@mtasv.net".
// A reply to a Postmark email therefore also has to be looked up by the bare id.
const POSTMARK_MESSAGE_ID = /^(.+)@mtasv\.net$/i;

export function replyLookupIds(reference: string): string[] {
  const value = String(reference || "").trim();
  if (!value) return [];
  const postmarkId = value.match(POSTMARK_MESSAGE_ID)?.[1];
  return postmarkId ? [value, postmarkId] : [value];
}
