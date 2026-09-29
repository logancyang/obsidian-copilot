export const OPENCODE_ZEN_PROVIDER_ID = "opencode";

export function isOpencodeZenWireId(wireId: string): boolean {
  return wireId.startsWith(`${OPENCODE_ZEN_PROVIDER_ID}/`);
}
