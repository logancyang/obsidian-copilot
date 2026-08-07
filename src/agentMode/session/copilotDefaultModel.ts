import type { BackendDescriptor, BackendId } from "./types";
import { type CopilotSettings, getSettings, setSettings } from "@/settings/model";

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
  const targets = new Map<BackendId, string>();
  for (const descriptor of descriptors) {
    const baseModelId = descriptor.getWireBaseId?.(configuredModelId, settings) ?? null;
    if (baseModelId) targets.set(descriptor.id, baseModelId);
  }
  if (targets.size === 0) return [];

  // One write for all backends: `onDefaultSelectionsChanged` re-applies the new
  // default to every live session on each changed backend, so writing per
  // backend would fan out that work once per agent for a single user action.
  setSettings((cur: CopilotSettings) => {
    const backends = { ...cur.agentMode.backends } as Record<
      string,
      Record<string, unknown> | undefined
    >;
    for (const [backendId, baseModelId] of targets) {
      backends[backendId] = {
        ...(backends[backendId] ?? {}),
        defaultModel: { baseModelId, effort: null },
      };
    }
    return { agentMode: { ...cur.agentMode, backends } };
  });
  return [...targets.keys()];
}
