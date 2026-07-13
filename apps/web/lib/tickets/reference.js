const TICKET_PREFIX = "T-";

export function ticketNumberValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\D/g, ""));
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

export function formatTicketReference(value, fallback = "No ticket ID") {
  const numeric = ticketNumberValue(value);
  return numeric ? `${TICKET_PREFIX}${numeric}` : fallback;
}

export function ticketReferenceSearchTerms(value) {
  const numeric = ticketNumberValue(value);
  if (!numeric) return [];
  const raw = String(numeric);
  return [
    `${TICKET_PREFIX}${raw}`.toLowerCase(),
    raw,
    `#${raw}`,
    `${TICKET_PREFIX}${raw.padStart(6, "0")}`.toLowerCase(),
  ];
}

export function matchesTicketReference(value, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  return ticketReferenceSearchTerms(value).some((term) => term.includes(normalized));
}
