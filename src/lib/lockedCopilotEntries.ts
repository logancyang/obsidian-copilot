import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { ChatModelProviders } from "@/constants";
import type { ModelInfo } from "@/modelManagement";
import { DEFAULT_COPILOT_PLUS_CHAT_MODEL } from "@/plusUtils";
import type { CopilotSettings } from "@/settings/model";

/** See AGENTS.md → "Referential stability". */
const EMPTY_ENTRIES: readonly ModelSelectorEntry[] = Object.freeze([]);

const LICENSE_REQUIRED = "Copilot license required";

/**
 * The one model previewed to a user without a license: the model a license
 * would land them on, so the preview and the outcome match — activate, and this
 * row loses its lock in place rather than being replaced by a different one.
 * Falls back to whatever a license switches on first when the lineup no longer
 * carries the default, since an offer naming some model beats no offer.
 *
 * A single row because the picker is 288px tall: every extra one pushes the
 * checkmark on the user's current model closer to the fold, and one row states
 * the offer as well as a list does. Undefined before the first successful
 * catalog fetch, which renders as no preview rather than a stale one.
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

/**
 * Whether a surface should advertise the lineup — true exactly when no Copilot
 * provider is registered, which is the absence these rows exist to fill.
 *
 * Deliberately not `!isPaidUser`: the two agree in practice, but a license state
 * that has not resolved while the provider is still registered would put locked
 * copies beside working models. Asking about the provider cannot produce that.
 *
 * Equally deliberately not "are there Copilot rows to render": registering the
 * provider and reconciling its models are separate writes, so a failure between
 * them leaves a licensed user with the provider and no rows — and inferring from
 * the rows would then advertise a license they already bought.
 *
 * @param providers - Caller-owned provider rows, keyed by provider id.
 */
export function shouldPreviewCopilotModels(providers: CopilotSettings["providers"]): boolean {
  return !Object.values(providers).some((provider) => provider.origin.kind === "copilot-plus");
}

/**
 * The non-selectable row advertising a Copilot model a license would unlock,
 * as a list so a caller can splice it in and an uncached lineup contributes
 * nothing.
 *
 * It exists only for the duration of a render — it is never a `Provider` or
 * `ConfiguredModel` row, so nothing can select, enroll, or default to it, and a
 * licensed user never sees it (the real models are there instead). That
 * separation is the point: without a license the provider is unregistered, so a
 * picker built from settings alone has nothing Copilot to show and the user has
 * no way to learn the models exist.
 *
 * @param catalog - Caller-owned cached Plus lineup, from
 *   `settings.copilotPlusCatalog`. Passed in rather than read here so the
 *   row re-renders when a fresh lineup lands.
 * @param opts.group - Section header to file the row under, for pickers that
 *   group by agent. Omit for a flat picker.
 * @param opts.backendId - Backend the row belongs to, which keeps its picker
 *   key distinct when several agents each preview the same model.
 */
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
      // `_disabledReason` is what disables the row; the lock icon is what explains
      // it, so the same sentence serves as the native title fallback.
      _disabledReason: LICENSE_REQUIRED,
      _needsLicense: true,
      _subtitle: previewed.description,
      _group: opts.group,
      _backendId: opts.backendId,
    },
  ];
}
