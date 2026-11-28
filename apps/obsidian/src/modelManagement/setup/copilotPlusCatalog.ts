import type { BrevilabsModelEntry, BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import type { ModelInfo } from "@/modelManagement/types/catalog";

const NO_EFFORTS: readonly string[] = Object.freeze([]);

export interface CopilotPlusCatalog {
  models: readonly ModelInfo[];
  defaultEnabledIds: readonly string[];
}

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

function parseReasoningEfforts(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0) return NO_EFFORTS;
  const levels = raw
    .filter((level): level is string => typeof level === "string")
    .map((level) => level.trim())
    .filter((level) => level.length > 0);
  return levels.length > 0 ? Object.freeze(levels) : undefined;
}

// An unreadable entry is rejected, not partially read: the payload is untrusted and a bad field
// must leave the last good lineup standing:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/319
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
