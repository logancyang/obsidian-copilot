/**
 * opencode Zen — opencode's own hosted gateway provider. Its models carry the
 * `opencode/` wire-id prefix and make up opencode's free model tier. We surface
 * a privacy warning for them because, unlike a self-hosted/BYOK model, prompts
 * are sent to a third party whose terms may allow logging or training.
 */
export const OPENCODE_ZEN_PROVIDER_ID = "opencode";

/** `true` when a wire base id belongs to opencode Zen (`opencode/<model>`). */
export function isOpencodeZenWireId(wireId: string): boolean {
  return wireId.startsWith(`${OPENCODE_ZEN_PROVIDER_ID}/`);
}
