export const SUPPORTED_SUPPORT_LANGUAGE_CODES = ["en", "da", "de", "es", "fr", "sv", "no"];

export const SUPPORT_LANGUAGE_LABELS = {
  en: "English",
  da: "Danish",
  de: "German",
  es: "Spanish",
  fr: "French",
  sv: "Swedish",
  no: "Norwegian",
};

const SUPPORTED_SET = new Set(SUPPORTED_SUPPORT_LANGUAGE_CODES);

export function isSupportedSupportLanguage(value) {
  return SUPPORTED_SET.has(String(value || "").trim().toLowerCase());
}

export function normalizeSupportLanguage(value, fallback = "en") {
  const normalized = String(value || "").trim().toLowerCase();
  if (SUPPORTED_SET.has(normalized)) return normalized;
  return isSupportedSupportLanguage(fallback) ? String(fallback).trim().toLowerCase() : "en";
}

export function getSupportLanguageLabel(value) {
  const normalized = normalizeSupportLanguage(value);
  return SUPPORT_LANGUAGE_LABELS[normalized] || SUPPORT_LANGUAGE_LABELS.en;
}
