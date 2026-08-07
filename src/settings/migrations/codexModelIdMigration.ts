/**
 * One-time migration (settings v14): fold Codex's per-effort configured models
 * into one row per base model.
 *
 * Copilot used to decode codex wire ids with the wrong delimiter (see
 * `codexModelId` for the real format), so every id decoded as an effort-less
 * base model and discovery enrolled one `ConfiguredModel` per (model × effort)
 * pair: six `gpt-5.6-sol` rows instead of one, each with its own enable toggle.
 *
 * Once the codec reads the real format, discovery reports base ids and
 * `syncAgentModels` would remove every bracketed row — taking the user's
 * enabled set with it. This migration renames the rows in place instead, so the
 * `configuredModelId`s that `backends.codex.enabledModels` references survive.
 */

import type { ModelSelection } from "@/agentMode";
import type { ConfiguredModel } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { parseCodexModelId } from "@/utils/codexModelId";

/** The settings slices the collapse rewrites. Only present fields need writing. */
export interface CodexModelIdCollapsePlan {
  /** Replacement `configuredModels`, per-effort codex rows folded into one per base model. */
  configuredModels: ConfiguredModel[];
  /** Replacement `backends.codex.enabledModels`, repointed at the surviving rows. */
  enabledModels: string[];
  /** Replacement `agentMode.backends.codex.defaultModel`; absent when it needed no change. */
  defaultModel?: ModelSelection;
}

/**
 * Pure planner: returns the rewritten codex slices, or `null` when nothing
 * changed (so the caller can skip a redundant write — see AGENTS.md
 * "Referential stability"). Idempotent — a vault whose rows are already in base
 * form plans no change.
 */
export function planCodexModelIdCollapse(
  settings: CopilotSettings
): CodexModelIdCollapsePlan | null {
  const codexProviderIds = new Set(
    Object.values(settings.providers ?? {})
      .filter((p) => p.origin.kind === "agent" && p.origin.agentType === "codex")
      .map((p) => p.providerId)
  );

  const configuredModels: ConfiguredModel[] = [];
  /** Surviving row per `(provider, base model)`, so repeat variants fold onto the first. */
  const survivorByBaseModel = new Map<string, ConfiguredModel>();
  /** Every original row id → the row id that now represents it. */
  const survivorByModelId = new Map<string, string>();
  let rowsChanged = false;

  for (const model of settings.configuredModels ?? []) {
    if (!codexProviderIds.has(model.providerId)) {
      configuredModels.push(model);
      continue;
    }
    const { baseModelId, effort } = parseCodexModelId(model.info.id);
    const key = `${model.providerId}\u0000${baseModelId}`;
    const survivor = survivorByBaseModel.get(key);
    if (survivor) {
      // A later variant of a base model already kept — drop the row and point
      // any reference to it at the survivor.
      survivorByModelId.set(model.configuredModelId, survivor.configuredModelId);
      rowsChanged = true;
      continue;
    }
    const kept: ConfiguredModel =
      effort === null
        ? model
        : {
            ...model,
            info: {
              ...model.info,
              id: baseModelId,
              displayName: stripEffortLabel(model.info.displayName, effort),
            },
          };
    if (kept !== model) rowsChanged = true;
    survivorByBaseModel.set(key, kept);
    survivorByModelId.set(model.configuredModelId, kept.configuredModelId);
    configuredModels.push(kept);
  }

  // A base model stays enabled when any of its effort variants was.
  const previousEnabled = settings.backends?.codex?.enabledModels ?? [];
  const enabledModels: string[] = [];
  const alreadyEnabled = new Set<string>();
  for (const configuredModelId of previousEnabled) {
    const resolved = survivorByModelId.get(configuredModelId) ?? configuredModelId;
    if (alreadyEnabled.has(resolved)) continue;
    alreadyEnabled.add(resolved);
    enabledModels.push(resolved);
  }
  const enabledChanged =
    enabledModels.length !== previousEnabled.length ||
    enabledModels.some((id, i) => id !== previousEnabled[i]);

  // The sticky default holds a whole wire id in `baseModelId` (effort never
  // decoded, so it is null); the bracketed level is the one actually applied.
  const previousDefault = settings.agentMode?.backends?.codex?.defaultModel;
  const parsedDefault = previousDefault ? parseCodexModelId(previousDefault.baseModelId) : null;
  const defaultModel =
    parsedDefault && parsedDefault.effort !== null
      ? { baseModelId: parsedDefault.baseModelId, effort: parsedDefault.effort }
      : undefined;

  if (!rowsChanged && !enabledChanged && !defaultModel) return null;
  return { configuredModels, enabledModels, ...(defaultModel ? { defaultModel } : {}) };
}

/**
 * Drop the `(low)` codex appends to a per-effort model's display name, so the
 * surviving row reads as the base model until the next probe refreshes it.
 * Left alone when the parenthesized token isn't the effort this row carried.
 */
function stripEffortLabel(displayName: string, effort: string): string {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(displayName);
  if (!match || match[2].toLowerCase() !== effort.toLowerCase()) return displayName;
  return match[1].trim() || displayName;
}
