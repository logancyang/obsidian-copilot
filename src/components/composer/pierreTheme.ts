import { registerCustomCSSVariableTheme } from "@pierre/diffs";

/**
 * Custom Shiki theme name used by every Pierre-based renderer in this
 * codebase. Registered once at module load via {@link ensurePierreThemeRegistered}.
 *
 * Every syntax-token role maps to an Obsidian text variable so that markdown
 * headings, bold, links, code, etc. inside the diff render in the user's
 * editor colors instead of Pierre's stock red/orange/cyan palette. The diff
 * red/green wash comes from a separate CSS layer (see `.copilot-pierre-view`
 * in tailwind.css) and is unaffected by this theme — that lives on the line
 * background, not the text foreground.
 */
export const OBSIDIAN_PIERRE_THEME = "obsidian";

let registered = false;

/**
 * Register the Obsidian Shiki theme exactly once. Safe to call repeatedly —
 * subsequent calls are no-ops. Every Pierre-based renderer in this codebase
 * should call this once before rendering.
 */
export function ensurePierreThemeRegistered(): void {
  if (registered) return;
  registerCustomCSSVariableTheme(OBSIDIAN_PIERRE_THEME, {
    foreground: "var(--text-normal)",
    background: "transparent",
    "token-constant": "var(--color-orange)",
    "token-string": "var(--text-normal)",
    "token-string-expression": "var(--text-normal)",
    "token-comment": "var(--text-muted)",
    "token-keyword": "var(--text-normal)",
    "token-parameter": "var(--text-normal)",
    "token-function": "var(--text-normal)",
    "token-punctuation": "var(--text-muted)",
    "token-link": "var(--text-accent)",
  });
  registered = true;
}

ensurePierreThemeRegistered();
