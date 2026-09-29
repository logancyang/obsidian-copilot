// codex-acp rejects a bare model id in `session/set_model`; it expects `modelId[effort]`.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/219

export interface CodexModelId {
  baseModelId: string;
  effort: string | null;
}

const CODEX_WIRE_ID = /^([^[\]]+)\[([^[\]]+)\]$/;

export function parseCodexModelId(wireId: string): CodexModelId {
  const match = CODEX_WIRE_ID.exec(wireId);
  if (!match) return { baseModelId: wireId, effort: null };
  return { baseModelId: match[1], effort: match[2] };
}

export function formatCodexModelId(baseModelId: string, effort: string | null): string {
  if (!effort) throw new Error("Choose an explicit effort for the Codex model.");
  return `${baseModelId}[${effort}]`;
}
