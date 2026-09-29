export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE, "zh-CN", "zh-TW"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const OBSIDIAN_LOCALE_MAP: Readonly<Record<string, SupportedLocale>> = Object.freeze({
  // Obsidian names Simplified Chinese `zh`; Copilot uses the explicit catalog
  // id so Taiwan Traditional can never inherit Simplified messages.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/324
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hant": "zh-TW",
  "zh-hant-tw": "zh-TW",
  "zh-tw": "zh-TW",
});

/** Resolve an Obsidian interface language to a bundled Copilot catalog. */
export function resolveLocale(obsidianLocale: string): SupportedLocale {
  return OBSIDIAN_LOCALE_MAP[obsidianLocale.toLowerCase().replace("_", "-")] ?? DEFAULT_LOCALE;
}
