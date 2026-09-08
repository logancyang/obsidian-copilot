type MiyoReferralSurface =
  | "license_settings"
  | "pairing"
  | "miyo_settings"
  | "connection"
  | "relevant_notes";

/**
 * Attribute a Miyo visit to its Copilot entry point without user or vault data.
 * @param surface The fixed UI entry point that opens the Miyo website.
 */
export function createMiyoPageUrl(surface: MiyoReferralSurface): string {
  const url = new URL("https://www.miyo.md/");
  url.searchParams.set("utm_source", "obsidian_copilot");
  url.searchParams.set("utm_medium", surface);
  return url.toString();
}
