/**
 * One-time migration (settings v15): store each backend's default model beside
 * the enabled list it has to come from.
 *
 * "Which model does this backend start on" used to be persisted in two
 * unrelated places and two id formats — `settings.defaultModelKey` for Quick
 * Chat, `settings.agentMode.backends.<id>.defaultModel` for each agent — while
 * the enabled list lived under `settings.backends.<id>` keyed by
 * `configuredModelId`. This restates both in the enabled list's own id space,
 * so "the default must be one of the enabled models" becomes answerable from
 * one object.
 *
 * Nothing is guessed. Only a saved value that names exactly one enabled model
 * migrates; anything else leaves the default unset — which reads back as
 * "first enabled", the same value the old readers produced for a key they
 * could not resolve.
 */

import type {
  AgentType,
  BackendDefaultModel,
  BackendType,
  ConfiguredModel,
  EnabledBackendEntry,
  Provider,
} from "@/modelManagement";
import { isChatModelSelectionForEntry } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { parseCodexModelId } from "@/utils/codexModelId";
import { opencodeWireBaseId } from "@/utils/opencodeModelId";

const AGENT_BACKENDS: readonly AgentType[] = ["opencode", "claude", "codex"];

/** A saved default this migration refused to map, and why. */
export interface UnresolvedBackendDefault {
  backend: BackendType;
  /** The saved value, in whatever id format that backend used for it. */
  saved: string;
  /** `"no-match"`: no enabled model computes to it. `"ambiguous"`: several do. */
  reason: "no-match" | "ambiguous";
}

export interface BackendDefaultModelPlan {
  /** Replacement `settings.backends`, or `null` when no default resolved. */
  backends: CopilotSettings["backends"] | null;
  /** Saved defaults left unset rather than guessed at. */
  unresolved: readonly UnresolvedBackendDefault[];
}

/**
 * The wire id an agent addressed one of its configured models by, as of this
 * settings version.
 *
 * Restated here rather than read off each `BackendDescriptor`: the descriptors
 * live behind the Agent Mode barrel, which loads Node built-ins and crashes the
 * plugin on mobile, and migrations run on every platform. Pinning the formats
 * also keeps this one-time transform stable if a codec later changes — a
 * migration converts the data as it was written, not as it is written next.
 *
 * @param backend - Agent whose addressing format applies.
 * @param model - The configured row being translated.
 * @param provider - The row's provider; opencode's id carries a provider prefix.
 */
function wireBaseIdFor(
  backend: AgentType,
  model: ConfiguredModel,
  provider: Provider | undefined
): string | null {
  switch (backend) {
    // Claude addresses its own models by their bare id.
    case "claude":
      return model.info.id;
    // codex-acp appends `[effort]`; the enabled rows hold the base id (v14).
    case "codex":
      return parseCodexModelId(model.info.id).baseModelId;
    // opencode routes Copilot-side providers, so the id carries their prefix.
    case "opencode":
      return provider ? opencodeWireBaseId(provider, model.info.id) : null;
  }
}

/** The chat backend's enabled rows, joined the way the pickers join them. */
function chatEntries(settings: CopilotSettings): EnabledBackendEntry[] {
  return (settings.backends?.chat?.enabledModels ?? []).map((configuredModelId) => {
    const configuredModel = settings.configuredModels?.find(
      (model) => model.configuredModelId === configuredModelId
    );
    const provider = configuredModel ? settings.providers?.[configuredModel.providerId] : undefined;
    return configuredModel && provider
      ? { configuredModelId, state: "ok" as const, configuredModel, provider }
      : { configuredModelId, state: "broken" as const };
  });
}

/**
 * The enabled model an agent's saved wire id names, or `null` plus the reason
 * when it names none or several.
 *
 * Forward computation, never reverse parsing: each enabled row is asked what id
 * it would be addressed by, and only an unmatched-by-exactly-one saved id is
 * accepted. Reverse parsing would mean running each backend's codec backwards,
 * and wire ids are not unique across provider rows.
 */
function matchAgentDefault(
  settings: CopilotSettings,
  backend: AgentType,
  savedBaseModelId: string
): { configuredModelId: string } | { reason: "no-match" | "ambiguous" } {
  const matches: string[] = [];
  for (const configuredModelId of settings.backends?.[backend]?.enabledModels ?? []) {
    const model = settings.configuredModels?.find(
      (row) => row.configuredModelId === configuredModelId
    );
    if (!model) continue;
    const provider = settings.providers?.[model.providerId];
    if (wireBaseIdFor(backend, model, provider) === savedBaseModelId)
      matches.push(model.configuredModelId);
  }
  if (matches.length === 1) return { configuredModelId: matches[0] };
  return { reason: matches.length === 0 ? "no-match" : "ambiguous" };
}

/**
 * Pure planner. Total by construction: each backend is resolved inside its own
 * `try`, so a corrupt row costs that backend's default and nothing else.
 *
 * Those guards cover a state the load path really can deliver, not a
 * theoretical one. `sanitizeSettings` coerces `backends`, `providers`, and
 * `configuredModels` to the right container type but validates nothing inside
 * them, so a synced or hand-edited row arrives here as written: a
 * `backends.chat.enabledModels` string reaches `.map`, an `enabledModels`
 * object reaches `matchAgentDefault`'s `for…of` as a non-iterable, and a
 * `providers.<id>` row without `displayName` reaches `.toLowerCase()` inside
 * `isChatModelSelectionForEntry`. A throw escaping here would abort `onload`
 * at the migration await and skip the unconditional `settingsVersion` bump
 * that follows, leaving every migration to re-run on every load. One unmapped
 * preference is the cheaper failure.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/540
 *
 * @param settings - The vault's settings as loaded, before any v15 write.
 */
export function planBackendDefaultModels(settings: CopilotSettings): BackendDefaultModelPlan {
  const resolved = new Map<BackendType, BackendDefaultModel>();
  const unresolved: UnresolvedBackendDefault[] = [];

  // Only a chat key that explicitly names an enabled model migrates. The old
  // reader answered "the model you saved" and "the first enabled one" with the
  // same value, so accepting its answer would pin a fallback as a choice the
  // user never made — and a Copilot Plus key, unresolvable until the licensed
  // rows sync back in, would be pinned to a stand-in forever instead of
  // self-correcting the way the pointer did.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/540
  try {
    const savedChatKey = settings.defaultModelKey;
    const hit = savedChatKey
      ? chatEntries(settings).find(
          (entry) => entry.state === "ok" && isChatModelSelectionForEntry(entry, savedChatKey)
        )
      : undefined;
    if (hit) resolved.set("chat", { configuredModelId: hit.configuredModelId });
    else if (savedChatKey)
      unresolved.push({ backend: "chat", saved: savedChatKey, reason: "no-match" });
  } catch {
    if (settings.defaultModelKey) {
      unresolved.push({ backend: "chat", saved: settings.defaultModelKey, reason: "no-match" });
    }
  }

  for (const backend of AGENT_BACKENDS) {
    try {
      const saved = settings.agentMode?.backends?.[backend]?.defaultModel;
      if (!saved?.baseModelId) continue;
      const match = matchAgentDefault(settings, backend, saved.baseModelId);
      if ("configuredModelId" in match) {
        resolved.set(backend, {
          configuredModelId: match.configuredModelId,
          effort: saved.effort ?? null,
        });
      } else {
        unresolved.push({ backend, saved: saved.baseModelId, reason: match.reason });
      }
    } catch {
      unresolved.push({ backend, saved: "<unreadable>", reason: "no-match" });
    }
  }

  if (resolved.size === 0) return { backends: null, unresolved };

  const backends = { ...settings.backends };
  for (const [backend, next] of resolved) {
    backends[backend] = { enabledModels: backends[backend]?.enabledModels ?? [], default: next };
  }
  return { backends, unresolved };
}
