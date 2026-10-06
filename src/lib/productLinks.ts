export const PRODUCT_URLS = {
  COPILOT: "https://www.obsidiancopilot.com/",
  COPILOT_PRICING: "https://www.obsidiancopilot.com/pricing",
  COPILOT_DASHBOARD: "https://www.obsidiancopilot.com/dashboard",
  MIYO: "https://www.miyo.md/",
  OPENARTIFACTS: "https://openartifacts.ai/",
} as const;

type ProductUrl = (typeof PRODUCT_URLS)[keyof typeof PRODUCT_URLS];

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
  | "model_settings_lock"
  | "preview_hint";

export function createProductUrl(destination: ProductUrl, medium: ProductUtmMedium): string {
  const url = new URL(destination);
  url.searchParams.set("utm_source", "obsidian_copilot");
  url.searchParams.set("utm_medium", medium);
  return url.toString();
}
