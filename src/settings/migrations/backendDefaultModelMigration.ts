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

export interface UnresolvedBackendDefault {
  backend: BackendType;
  saved: string;
  reason: "no-match" | "ambiguous";
}

export interface BackendDefaultModelPlan {
  backends: CopilotSettings["backends"] | null;
  unresolved: readonly UnresolvedBackendDefault[];
}

// Pinned here, not read off descriptors: the Agent Mode barrel crashes mobile, and a migration
// converts data as it was written. https://github.com/Brevilabs/obsidian-copilot-private/issues/540
function wireBaseIdFor(
  backend: AgentType,
  model: ConfiguredModel,
  provider: Provider | undefined
): string | null {
  switch (backend) {
    case "claude":
      return model.info.id;
    case "codex":
      return parseCodexModelId(model.info.id).baseModelId;
    case "opencode":
      return provider ? opencodeWireBaseId(provider, model.info.id) : null;
  }
}

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
