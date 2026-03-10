function escapeHtml(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkifyUrls(input: string): string {
  return String(input || "").replace(/(https?:\/\/[^\s<]+)/gi, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

export function formatEmailBody(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const html = linkifyUrls(escapeHtml(normalized)).replace(/\n/g, "<br />");
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #000000; line-height: 1.5;">${html}</div>`;
}
