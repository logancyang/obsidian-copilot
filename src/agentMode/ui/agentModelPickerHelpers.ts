import type { CommandResult } from "@/agentMode/protocol/commands";
import { resolveEfforts, baseModelIdOf } from "@/agentMode/protocol/pickerEntries";
import type { BackendSummary, PickerModel } from "@/agentMode/protocol/state";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel } from "@/lib/model-key";
import { logError } from "@/logger";
import { Notice } from "obsidian";

export type PickerEffortOptions = { label: string; value: string | null }[];

export function toModelSelectorEntry(model: PickerModel): ModelSelectorEntry {
  return {
    name: model.name,
    provider: model.provider,
    enabled: true,
    isBuiltIn: false,
    displayName: model.displayName,
    capabilities: model.capabilities,
    _group: model.group,
    _backendId: model.backendId,
    _subtitle: model.subtitle,
    _isFree: model.isFree,
    _disabledReason: model.disabledReason,
    _needsSelfHostWarning: model.needsSelfHostWarning,
    _needsLicense: model.needsLicense,
  };
}

export function buildEffortOptionsByModelKey(
  backends: readonly BackendSummary[],
  entries: readonly PickerModel[]
): Record<string, PickerEffortOptions> {
  const out: Record<string, PickerEffortOptions> = {};
  for (const entry of entries) {
    const baseModelId = baseModelIdOf(entry);
    if (!entry.backendId || !baseModelId) continue;
    out[getModelKeyFromModel(toModelSelectorEntry(entry))] = [
      ...resolveEfforts(backends, entry.backendId, baseModelId),
    ];
  }
  return out;
}

/**
 * Tells the user why a switch did not happen. `stale` means the session the control was drawn
 * for has since changed, so the control is about to redraw and there is nothing to report.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function reportSwitchFailure(
  result: Extract<CommandResult, { ok: false }>,
  action: "model" | "effort" | "mode"
): void {
  if (result.code === "stale") return;
  if (result.code === "unsupported") {
    new Notice(`This agent doesn't support runtime ${action} switching.`);
    return;
  }
  logError(`[AgentMode] ${action} apply failed (${result.code}): ${result.message}`);
  new Notice(`Failed to switch ${action}. See console for details.`);
}
