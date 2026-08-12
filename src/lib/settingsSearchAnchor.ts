/**
 * Anchor derivation for the settings-search deep links.
 *
 * A settings row's DOM anchor derives from its display title, so the search
 * manifest (`@/settings/v2/settingsSearch`) and the row components that
 * stamp the attribute stay linked by the title string alone. Lives in
 * `@/lib` because presentational components consume it and must not reach
 * into `@/settings`.
 */

/** Attribute stamped on a rendered settings row so deep links can find it. */
export const SETTINGS_SEARCH_ANCHOR_ATTR = "data-copilot-setting";

/**
 * Derives the stable DOM anchor for a setting from its display title.
 * @param name The setting's display title as shown in the settings UI.
 */
export function settingsSearchAnchor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Spread-ready anchor attribute for a settings row, derived from its title.
 * Returns undefined when the title is not a plain string (rows with rich
 * titles get no anchor and fall back to tab-level navigation).
 * @param title The row title as passed to the row component; only plain
 * strings produce an anchor.
 */
export function settingsSearchAnchorAttrs(title: unknown): Record<string, string> | undefined {
  if (typeof title !== "string" || title.length === 0) return undefined;
  return { [SETTINGS_SEARCH_ANCHOR_ATTR]: settingsSearchAnchor(title) };
}
