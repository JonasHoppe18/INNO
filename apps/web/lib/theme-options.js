export const DEFAULT_THEME = "light";

export const THEME_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const VALID_THEME_IDS = new Set(THEME_OPTIONS.map((option) => option.id));

export function isValidTheme(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_THEME_IDS.has(normalized);
}

export function normalizeThemePreference(value, fallback = DEFAULT_THEME) {
  const normalized = String(value || "").trim().toLowerCase();
  if (isValidTheme(normalized)) return normalized;
  return fallback;
}
