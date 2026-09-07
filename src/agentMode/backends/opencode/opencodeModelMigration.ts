import type { ModelEntry, ModelSelection } from "@/agentMode/session/types";

// The historical decoder split only these suffixes. This compatibility list must
// not grow when an agent introduces another effort level.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/219
const LEGACY_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Identify reported literal IDs previously collapsed into a discovered model row.
 * @param modelIds - Complete IDs in the current agent catalog.
 */
export function legacyOpencodeModelIds(modelIds: readonly string[]): ReadonlyMap<string, string> {
  const ids = new Set(modelIds);
  const aliases = new Map<string, string>();
  for (const id of ids) {
    const segments = id.split("/");
    const base = segments.slice(0, -1).join("/");
    // A real base model must retain its identity and enabled state.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
    if (
      segments.length >= 3 &&
      LEGACY_EFFORTS.has(segments[segments.length - 1]) &&
      !ids.has(base)
    ) {
      aliases.set(id, base);
    }
  }
  return aliases;
}

/**
 * Restore the exact literal model selected through the historical suffix decoder.
 * @param selection - Saved or already-captured model preference.
 * @param availableModels - Current catalog used to distinguish model IDs from effort.
 */
export function normalizeOpencodeSelection(
  selection: ModelSelection,
  availableModels: readonly ModelEntry[]
): ModelSelection {
  const literalId = `${selection.baseModelId}/${selection.effort}`;
  // The explicit saved suffix identifies the model even when discovery collapsed
  // several literal IDs into one row. Never infer a choice from catalog order.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  if (
    selection.effort &&
    legacyOpencodeModelIds(availableModels.map((m) => m.baseModelId)).has(literalId)
  ) {
    return { baseModelId: literalId, effort: null };
  }
  return selection;
}
