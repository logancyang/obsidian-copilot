import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { ChatModelProviders } from "@/constants";
import type { CopilotSettings } from "@/settings/model";
import { COPILOT_PLUS_DEFAULT_ENABLED_MODELS, COPILOT_PLUS_MODELS } from "@/modelManagement";

/** See AGENTS.md → "Referential stability". */
const EMPTY_ENTRIES: readonly ModelSelectorEntry[] = Object.freeze([]);

const LICENSE_REQUIRED = "Copilot license required";

/**
 * The lineup previewed to a user without a license: exactly the models a
 * license switches on, so the preview and the outcome match — activate, and
 * these three rows lose their locks in place rather than being replaced by a
 * different set.
 *
 * Showing all eight would bury the user's own models: the picker is 288px tall,
 * so a full lineup pushes the checkmark on their current model below the fold.
 */
const PREVIEWED_MODELS = COPILOT_PLUS_MODELS.filter((model) =>
  COPILOT_PLUS_DEFAULT_ENABLED_MODELS.includes(model.id)
);

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
 * Non-selectable rows advertising the Copilot models a license would unlock.
 *
 * These exist only for the duration of a render — they are never `Provider` or
 * `ConfiguredModel` rows, so nothing can select, enroll, or default to one, and
 * a licensed user never sees them (the real models are there instead). That
 * separation is the point: without a license the provider is unregistered, so a
 * picker built from settings alone has nothing Copilot to show and the user has
 * no way to learn the models exist.
 *
 * @param opts.group - Section header to file the rows under, for pickers that
 *   group by agent. Omit for a flat picker.
 * @param opts.backendId - Backend the rows belong to, which keeps their picker
 *   keys distinct when several agents each preview the same model.
 */
export function lockedCopilotEntries(
  opts: { group?: string; backendId?: string } = {}
): readonly ModelSelectorEntry[] {
  if (PREVIEWED_MODELS.length === 0) return EMPTY_ENTRIES;
  return PREVIEWED_MODELS.map((model) => ({
    name: model.id,
    provider: ChatModelProviders.COPILOT_PLUS,
    displayName: model.displayName || model.id,
    enabled: true,
    isBuiltIn: false,
    // `_disabledReason` is what disables the row; the lock icon is what explains
    // it, so the same sentence serves as the native title fallback.
    _disabledReason: LICENSE_REQUIRED,
    _needsLicense: true,
    _subtitle: model.description,
    _group: opts.group,
    _backendId: opts.backendId,
  }));
}
