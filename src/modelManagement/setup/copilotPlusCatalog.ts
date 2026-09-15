/**
 * Reads the Copilot Plus lineup published at `models.brevilabs.com/v1/models`.
 *
 * That endpoint is the only authority for which Plus models exist. A client
 * that carries its own list drifts the moment the service adds or withdraws a
 * model: withdrawn models stay selectable and fail at turn time, and new ones
 * stay invisible until the next plugin release.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 *
 * Parsing is deliberately all-or-nothing. A half-read response would reconcile
 * as "the service withdrew everything it didn't send", so anything that isn't
 * a well-formed lineup is reported as unreadable and the last good snapshot
 * stands.
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
 * @param display - The published label, which is a string on a well-formed
 *   response but is accepted as unknown so a malformed one is rejected here
 *   rather than by a cast at the call site.
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
 * absent or unusable.
 *
 * An empty list is a real answer — the model honors no level, so its consumer
 * should offer no control — and is kept distinct from the absent case. A list
 * that arrived with entries but none usable is malformed, not a model without
 * levels; reading it as the latter would delete a working effort menu on the
 * strength of garbage.
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

/** One catalog entry as a `ModelInfo`, or null when it carries no usable id. */
function toModelInfo(entry: BrevilabsModelEntry): ModelInfo | null {
  // The payload is untrusted JSON, so the declared `string` is a hope rather
  // than a guarantee. A non-string id would throw out of `trim()` and escape to
  // the caller's outer catch, skipping the unreadable-response fallback that is
  // supposed to keep a signed-in user's provider registered.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  if (typeof entry.id !== "string") return null;
  const id = entry.id.trim();
  if (!id) return null;

  const model: ModelInfo = {
    id,
    displayName: entry.label?.trim() || id,
  };
  const description = entry.description?.trim();
  if (description) model.description = description;
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
  const context = parseContextLength(entry.context_length);
  if (context !== null) model.limits = { context };
  return model;
}

/**
 * Whether an entry publishes a context window we could not read.
 *
 * Absent is fine — plenty of metadata is optional. Present but unreadable is
 * not: the reconcile writes `limits` from this snapshot, so accepting the entry
 * would replace a known window with nothing and leave the context meter
 * unsizable. The lineup is rejected instead, which keeps the last good one.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 */
function hasUnreadableContextLength(entry: BrevilabsModelEntry): boolean {
  return entry.context_length !== undefined && parseContextLength(entry.context_length) === null;
}

/**
 * The lineup a models-endpoint response describes, or null when it cannot be
 * read as one.
 *
 * Null covers every shape a caller must not reconcile against: a failed
 * request, a non-list payload, an entry with no id, a duplicate id, and an
 * empty lineup. All of them would otherwise be indistinguishable from the
 * service having withdrawn models it still serves.
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
    if (hasUnreadableContextLength(entry)) return null;
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
