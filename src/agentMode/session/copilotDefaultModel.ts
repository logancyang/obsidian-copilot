import type { BackendDescriptor, BackendId } from "./types";
import { type CopilotSettings, getSettings, setSettings } from "@/settings/model";

/**
 * The persisted per-backend row, taken from the settings type rather than
 * imported as `BackendConfig` from `@/modelManagement`, which `session/` may
 * not reach.
 */
type BackendRow = NonNullable<CopilotSettings["backends"][keyof CopilotSettings["backends"]]>;

/**
 * Make one configured model the durable default for every backend that can
 * route it.
 *
 * License activation enrolls the Copilot models into the backends that can
 * serve them, but enrolled only means "offered in the picker" — without a
 * stored default each new session still starts on whatever the agent picks for
 * itself. This closes that gap so a paying user's agents start on the model
 * their license just paid for.
 *
 * Which backends qualify is discovered, never listed: each is asked for its own
 * wire id for the model, so an agent added later is covered by implementing
 * `getWireBaseId` — no edit here. A backend serving only its own models
 * (claude, codex) omits that method and is skipped.
 *
 * Asking the descriptor rather than reading its enabled models is what makes
 * this safe to run the instant the model is configured: provider sync creates
 * the configured model first and enrolls it into each backend afterwards, so an
 * enrollment-based join would silently skip a backend that had not caught up.
 *
 * The stored effort is `null` ("agent default"), matching what the settings
 * picker persists for a model-only choice: seeding a model must not silently
 * commit the user to a reasoning effort they never picked.
 *
 * @param descriptors - Backends to consider; the caller supplies the registry
 *   so this stays backend-agnostic.
 * @param configuredModelId - The model to install as the default.
 * @returns Ids of the backends whose default was written, for logging.
 */
export function seedCopilotDefaultModel(
  descriptors: readonly BackendDescriptor[],
  configuredModelId: string
): BackendId[] {
  const settings = getSettings();
  const targets = descriptors
    .filter((descriptor) => descriptor.getWireBaseId?.(configuredModelId, settings))
    .map((descriptor) => descriptor.id);
  if (targets.length === 0) return [];

  // The one writer of `backends.<id>.default` that bypasses
  // `updateBackendDefaultModel`, and only to batch: `onDefaultSelectionsChanged`
  // re-applies the new default to every live session on each changed backend,
  // so writing per backend would fan that out once per agent for a single user
  // action.
  setSettings((cur: CopilotSettings) => {
    const backends = { ...cur.backends } as Record<string, BackendRow>;
    for (const backendId of targets) {
      // Spread the row, not just its enabled list: a field added to
      // `BackendConfig` later must survive this seed.
      backends[backendId] = {
        ...backends[backendId],
        enabledModels: backends[backendId]?.enabledModels ?? [],
        default: { configuredModelId, effort: null },
      };
    }
    return { backends };
  });
  return targets;
}
