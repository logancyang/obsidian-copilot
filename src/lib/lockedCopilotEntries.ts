import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { ChatModelProviders } from "@/constants";
import type { ModelInfo } from "@/modelManagement";
import { DEFAULT_COPILOT_PLUS_CHAT_MODEL } from "@/plusUtils";
import type { CopilotSettings } from "@/settings/model";

const EMPTY_ENTRIES: readonly ModelSelectorEntry[] = Object.freeze([]);

const LICENSE_REQUIRED = "Copilot license required";

/**
 * The one model previewed to a user without a license: the model a license would land them on.
 * A single row keeps the checkmark on the user's current model above the picker's fold.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 *
 * @param catalog - Caller-owned cached lineup, from `settings.copilotPlusCatalog`.
 */
function previewedModel(catalog: CopilotSettings["copilotPlusCatalog"]): ModelInfo | undefined {
  const defaultEnabled = new Set(catalog.defaultEnabledIds);
  const switchedOn = catalog.models.filter((model) => defaultEnabled.has(model.id));
  const defaultId = String(DEFAULT_COPILOT_PLUS_CHAT_MODEL);
  return switchedOn.find((model) => model.id === defaultId) ?? switchedOn[0];
}

export function shouldPreviewCopilotModels(providers: CopilotSettings["providers"]): boolean {
  return !Object.values(providers).some((provider) => provider.origin.kind === "copilot-plus");
}

export function lockedCopilotEntries(
  catalog: CopilotSettings["copilotPlusCatalog"],
  opts: { group?: string; backendId?: string } = {}
): readonly ModelSelectorEntry[] {
  const previewed = previewedModel(catalog);
  if (!previewed) return EMPTY_ENTRIES;
  return [
    {
      name: previewed.id,
      provider: ChatModelProviders.COPILOT_PLUS,
      displayName: previewed.displayName || previewed.id,
      enabled: true,
      isBuiltIn: false,
      _disabledReason: LICENSE_REQUIRED,
      _needsLicense: true,
      _subtitle: previewed.description,
      _group: opts.group,
      _backendId: opts.backendId,
    },
  ];
}
