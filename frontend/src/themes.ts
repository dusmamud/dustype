/**
 * dustype's own themes. Each theme is an original palette invented for
 * dustype (names and hex values are not copied from any other typing app).
 * A theme is injected as CSS custom properties on :root; the stylesheet
 * and components read those variables, so switching a theme recolours
 * the whole page without touching component code.
 */

export interface DustypeTheme {
  id: string;
  name: string;
  /** Page background. */
  bg: string;
  /** Card / input surface. */
  surface: string;
  /** Primary text. */
  text: string;
  /** Secondary / muted text. */
  muted: string;
  /** Accent: active buttons, highlights, chart line. */
  accent: string;
  /** Text drawn on top of the accent colour. */
  accentInk: string;
  /** Incorrect characters and error markers. */
  error: string;
  /** Borders. */
  border: string;
}

export const THEMES: DustypeTheme[] = [
  {
    id: "midnight-ink",
    name: "Midnight Ink",
    bg: "#13151c",
    surface: "#1c1f2a",
    text: "#eceef4",
    muted: "#9399ad",
    accent: "#6ee7b7",
    accentInk: "#0f1a14",
    error: "#fb7185",
    border: "#33374a",
  },
  {
    id: "paper-dawn",
    name: "Paper Dawn",
    bg: "#f6f3ec",
    surface: "#ffffff",
    text: "#26222b",
    muted: "#6f6a5e",
    accent: "#2f6f5e",
    accentInk: "#ffffff",
    error: "#c2412e",
    border: "#ddd5c6",
  },
  {
    id: "ember-dusk",
    name: "Ember Dusk",
    bg: "#1f1410",
    surface: "#2c1e17",
    text: "#f5e9dc",
    muted: "#b09a88",
    accent: "#f08a4b",
    accentInk: "#221207",
    error: "#ff6b5e",
    border: "#4a3226",
  },
  {
    id: "sea-glass",
    name: "Sea Glass",
    bg: "#0e1b1e",
    surface: "#16282c",
    text: "#e2f0ee",
    muted: "#7fa3a0",
    accent: "#5ec8c0",
    accentInk: "#0a1f1d",
    error: "#ff7a7a",
    border: "#2c4a4e",
  },
  {
    id: "lilac-field",
    name: "Lilac Field",
    bg: "#221a2e",
    surface: "#2e2440",
    text: "#f0eaf8",
    muted: "#a99bc2",
    accent: "#c4a0ff",
    accentInk: "#221433",
    error: "#ff7a8a",
    border: "#453a5e",
  },
];

export const DEFAULT_THEME_ID = "midnight-ink";
export const THEME_STORAGE_KEY = "dustype:theme";

export function themeById(id: string): DustypeTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Theme stored from a previous visit, or the default dark theme. */
export function initialThemeId(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    // Private mode / unavailable storage: fall through to the default.
  }
  return DEFAULT_THEME_ID;
}

/** Inject a theme's palette as CSS variables on :root and persist it. */
export function applyTheme(id: string): DustypeTheme {
  const theme = themeById(id);
  const root = document.documentElement;
  root.style.setProperty("--dt-bg", theme.bg);
  root.style.setProperty("--dt-surface", theme.surface);
  root.style.setProperty("--dt-text", theme.text);
  root.style.setProperty("--dt-muted", theme.muted);
  root.style.setProperty("--dt-accent", theme.accent);
  root.style.setProperty("--dt-accent-ink", theme.accentInk);
  root.style.setProperty("--dt-error", theme.error);
  root.style.setProperty("--dt-border", theme.border);
  root.dataset.dustypeTheme = theme.id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // Persisting is best-effort; the theme still applies for this visit.
  }
  return theme;
}
