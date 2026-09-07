/**
 * codex-acp's model addressing format, kept in a leaf module so the settings
 * migration that repairs persisted ids can reuse it without pulling in the
 * desktop-only Agent Mode barrel.
 *
 * codex-acp advertises one model per (base × effort) pair and names the format
 * itself: `session/set_model` with a bare id fails with "Unsupported format of
 * modelId: gpt-5.4. Expected: modelId[effort]." The bracket delimiter makes the
 * effort token unambiguous, so Copilot never enumerates effort levels —
 * whatever the CLI puts between the brackets is the effort, and a release that
 * introduces a new level (`max`, `ultra`, …) needs no plugin change.
 */

/** A codex wire id split into its parts; `effort` is null for an unbracketed id. */
export interface CodexModelId {
  baseModelId: string;
  effort: string | null;
}

/**
 * Anchored to the final bracket group and forbidding nested brackets, so only a
 * genuine trailing `[effort]` is peeled off. A model id that has no brackets —
 * or whose brackets aren't trailing — is returned whole.
 */
const CODEX_WIRE_ID = /^(.+)\[([^[\]]+)\]$/;

/** Split a codex wire id (`gpt-5.6-sol[ultra]`) into its base model and effort. */
export function parseCodexModelId(wireId: string): CodexModelId {
  const match = CODEX_WIRE_ID.exec(wireId);
  if (!match) return { baseModelId: wireId, effort: null };
  return { baseModelId: match[1], effort: match[2] };
}

/** Build the wire id codex addresses a (model, effort) pair by. */
export function formatCodexModelId(baseModelId: string, effort: string | null): string {
  return effort ? `${baseModelId}[${effort}]` : baseModelId;
}
