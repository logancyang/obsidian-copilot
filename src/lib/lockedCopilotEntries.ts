import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { ChatModelProviders } from "@/constants";
import type { ModelInfo } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

/** See AGENTS.md → "Referential stability". */
const EMPTY_ENTRIES: readonly ModelSelectorEntry[] = Object.freeze([]);

const LICENSE_REQUIRED = "Copilot license required";
const MAX_PREVIEWED_MODELS = 3;

/** Display metadata every live Plus picker surface consumes. */
export type CopilotPlusCatalogModel = Pick<ModelInfo, "id" | "displayName" | "description">;

/**
 * Resolve a Copilot Plus catalog row from either its raw id or an agent wire id.
 * Returns the existing catalog object so callers do not allocate display
 * metadata while rebuilding a picker.
 *
 * @param wireModelId - Raw Plus id or an agent-prefixed wire id.
 */
export function findCopilotPlusModel(
  wireModelId: string,
  models: readonly CopilotPlusCatalogModel[]
) {
  return models.find(
    (model) =>
      wireModelId === model.id || wireModelId === `${ChatModelProviders.COPILOT_PLUS}/${model.id}`
  );
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
  models: readonly CopilotPlusCatalogModel[],
  opts: { group?: string; backendId?: string } = {}
): readonly ModelSelectorEntry[] {
  if (models.length === 0) return EMPTY_ENTRIES;
  // Keep the preview compact enough that a user's own current model stays in
  // the 288px picker. The rows themselves always come from the live endpoint.
  return models.slice(0, MAX_PREVIEWED_MODELS).map((model) => ({
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
