import { registerCustomCSSVariableTheme } from "@pierre/diffs";

/**
 * Custom Shiki theme name used by every Pierre-based renderer in this codebase.
 * The theme is registered once at module load — module evaluation runs only
 * once, so no call-guard is needed.
 *
 * The values below are fallbacks. The colors that actually take effect inside
 * the Apply view come from the `.copilot-pierre-view` CSS layer in tailwind.css
 * (the `--diffs-*-override` and `--diffs-token-*` variables), which is the
 * source of truth for diff theming; edit that layer to change visible colors.
 */
export const OBSIDIAN_PIERRE_THEME = "obsidian";

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
