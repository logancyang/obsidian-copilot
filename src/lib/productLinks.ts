/**
 * Every Brevilabs marketing destination the plugin can send a user to. Keeping
 * the bare origins here is what lets {@link createProductUrl} be the only place
 * a plugin link is built, so analytics sees one source for all plugin traffic.
 *
 * `www.` is the canonical host for obsidiancopilot.com; the apex redirects.
 */
export const PRODUCT_URLS = {
  COPILOT: "https://www.obsidiancopilot.com/",
  COPILOT_PRICING: "https://www.obsidiancopilot.com/pricing",
  COPILOT_DASHBOARD: "https://www.obsidiancopilot.com/dashboard",
  MIYO: "https://www.miyo.md/",
  OPENARTIFACTS: "https://openartifacts.ai/",
} as const;

type ProductUrl = (typeof PRODUCT_URLS)[keyof typeof PRODUCT_URLS];

/**
 * The plugin placement a visit came from. Destinations are reachable from more
 * than one screen, so the placement — not the destination — is what tells the
 * two apart in analytics.
 */
export type ProductUtmMedium =
  | "settings"
  | "license_settings"
  | "usage_footer"
  | "pairing"
  | "miyo_settings"
  | "connection"
  | "relevant_notes"
  | "expired_modal"
  | "welcome_modal"
  | "chat_mode_select"
  | "multi_agent"
  | "model_picker_lock"
  | "model_settings_lock";

/**
 * Attribute an outbound product visit to its Copilot entry point without user
 * or vault data. Every anchor and button in the plugin that opens one of
 * {@link PRODUCT_URLS} goes through here.
 * @param destination The marketing page being opened.
 * @param medium The fixed UI placement the user clicked.
 */
export function createProductUrl(destination: ProductUrl, medium: ProductUtmMedium): string {
  const url = new URL(destination);
  url.searchParams.set("utm_source", "obsidian_copilot");
  url.searchParams.set("utm_medium", medium);
  return url.toString();
}
