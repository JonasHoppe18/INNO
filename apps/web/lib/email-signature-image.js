export async function uploadEmailSignatureImage(file, userId = "") {
  const formData = new FormData();
  formData.append("file", file);
  if (userId) formData.append("user_id", userId);

  const response = await fetch("/api/settings/email-signature/logo", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Could not upload logo.");
  }

  const url = String(payload?.image?.url || "").trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error("The uploaded logo did not return a public HTTPS URL.");
  }
  return url;
}

export function normalizeSignatureImageUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return url.toString();
  } catch {
    return "";
  }
}
