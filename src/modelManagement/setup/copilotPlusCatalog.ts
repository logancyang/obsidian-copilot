/**
 * Reads the Copilot Plus lineup published at `models.brevilabs.com/v1/models`,
 * the only authority for which Plus models exist. A client-side list drifts the
 * moment the service adds or withdraws a model.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 *
 * Parsing is all-or-nothing: a half-read response would reconcile as "the
 * service withdrew everything it didn't send", so anything that is not a
 * well-formed lineup reads as unreadable and the last good snapshot stands.
 */

import type { BrevilabsModelEntry, BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import type { ModelInfo } from "@/modelManagement/types/catalog";

/** See AGENTS.md → "Referential stability". */
const NO_EFFORTS: readonly string[] = Object.freeze([]);

/** The Plus lineup as one server response described it. */
export interface CopilotPlusCatalog {
  /** Every model the service currently serves, in the order it listed them. */
  models: readonly ModelInfo[];
  /** Wire ids a fresh sign-in should switch on. */
  defaultEnabledIds: readonly string[];
}

/**
 * Token count from the context-window label the catalog publishes (`1M`,
 * `256K`, `8192`), or null when it is not a form we recognize.
 *
 * The suffixes are binary: `1M` is the 1,048,576-token window and `256K` the
 * 262,144-token one, both rounded for display. Reading them as powers of ten
 * would put every context meter about 5% off.
 *
 * @param display - The published label, accepted as unknown so a malformed
 *   payload is rejected here rather than by a cast at the call site.
 */
export function parseContextLength(display: unknown): number | null {
  if (typeof display !== "string") return null;
  const match = /^\s*([\d.]+)\s*([KMkm])?\s*$/.exec(display);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2]?.toUpperCase();
  const multiplier = unit === "M" ? 1024 * 1024 : unit === "K" ? 1024 : 1;
  return Math.round(value * multiplier);
}

/**
 * Effort levels a published list contains, or undefined when the field is
 * absent or unusable. An empty list is a real answer (the model honors no
 * level, so offer no control) and stays distinct from the absent case; a list
 * with entries but none usable is malformed, and reading it as "no levels"
 * would delete a working effort menu on the strength of garbage.
 */
function parseReasoningEfforts(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0) return NO_EFFORTS;
  const levels = raw
    .filter((level): level is string => typeof level === "string")
    .map((level) => level.trim())
    .filter((level) => level.length > 0);
  return levels.length > 0 ? Object.freeze(levels) : undefined;
}

/**
 * One catalog entry as a `ModelInfo`, or null when it cannot be read as one:
 * no usable id, or optional metadata that is present but unreadable.
 *
 * Present-but-unreadable rejects the entry rather than dropping the field. The
 * payload is untrusted, so a declared string can arrive as a number and throw
 * out of `trim()` past the unreadable-response fallback; and the reconcile
 * writes `limits` from this snapshot, so an unparseable context window would
 * erase a known one. Both cases must leave the last good lineup standing.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 */
function toModelInfo(entry: BrevilabsModelEntry): ModelInfo | null {
  const { id, label, description, context_length } = entry;
  if (typeof id !== "string" || !id.trim()) return null;
  if (label !== undefined && typeof label !== "string") return null;
  if (description !== undefined && typeof description !== "string") return null;
  const context = context_length === undefined ? undefined : parseContextLength(context_length);
  if (context === null) return null;

  const model: ModelInfo = { id: id.trim(), displayName: label?.trim() || id.trim() };
  if (description?.trim()) model.description = description.trim();
  if (typeof entry.supports_tools === "boolean") model.toolCall = entry.supports_tools;
  if (typeof entry.supports_reasoning === "boolean") model.reasoning = entry.supports_reasoning;
  const efforts = parseReasoningEfforts(entry.reasoning_efforts);
  if (efforts) model.reasoningEfforts = efforts;
  if (typeof entry.supports_images === "boolean") {
    model.modalities = {
      input: entry.supports_images ? ["text", "image"] : ["text"],
      output: ["text"],
    };
  }
  if (context !== undefined) model.limits = { context };
  return model;
}

/**
 * The lineup a models-endpoint response describes, or null when it cannot be
 * read as one: a failed request, a non-list payload, an unreadable entry, a
 * duplicate id, or an empty lineup. Each would otherwise be indistinguishable
 * from the service having withdrawn models it still serves.
 *
 * @param response - Parsed endpoint body, or null when the request failed.
 */
export function readCopilotPlusCatalog(
  response: BrevilabsModelsResponse | null | undefined
): CopilotPlusCatalog | null {
  if (!Array.isArray(response?.data)) return null;

  const models: ModelInfo[] = [];
  const defaultEnabledIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of response.data) {
    if (!entry || typeof entry !== "object") return null;
    const model = toModelInfo(entry);
    if (!model || seen.has(model.id)) return null;
    seen.add(model.id);
    models.push(model);
    if (entry.default_enabled === true) defaultEnabledIds.push(model.id);
  }
  if (models.length === 0) return null;

  return {
    models: Object.freeze(models),
    defaultEnabledIds: Object.freeze(defaultEnabledIds),
  };
}
