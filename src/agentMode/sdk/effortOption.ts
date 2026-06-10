import type { BackendConfigOption } from "@/agentMode/session/types";
import {
  query,
  type EffortLevel,
  type ModelInfo,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { logWarn } from "@/logger";

/**
 * Build a single-select effort `BackendConfigOption` from a model's
 * advertised `supportedEffortLevels`. Returns `null` when the model
 * doesn't support effort or the SDK reports an empty list.
 *
 * The category is `"thought_level"` (the spec-conformant
 * `SessionConfigOptionCategory` reserved name) so future ACP-aware UIs
 * recognize it.
 */
export function synthesizeEffortConfigOption(
  modelInfo: ModelInfo | undefined,
  currentEffort: EffortLevel | undefined
): BackendConfigOption | null {
  const levels = modelInfo?.supportsEffort ? (modelInfo.supportedEffortLevels ?? []) : [];
  if (levels.length === 0) return null;
  const value = currentEffort && levels.includes(currentEffort) ? currentEffort : levels[0];
  return {
    id: "effort",
    type: "select",
    category: "thought_level",
    name: "Effort",
    currentValue: value,
    options: levels.map((v) => ({ value: v, name: v })),
  };
}

/**
 * Pick the model id to seed a session with. Honors a persisted preference
 * when it still appears in the live catalog (CLI revs can drop/rename
 * models); falls back to the first catalog entry. Returns `undefined` when
 * the catalog is empty — callers then send no `options.model` and the SDK
 * uses its default.
 */
export function resolveSeedModelId(
  catalog: ModelInfo[],
  defaultId: string | undefined
): string | undefined {
  if (defaultId && catalog.some((m) => m.value === defaultId)) return defaultId;
  if (defaultId) {
    logWarn(
      `[AgentMode] persisted Claude model "${defaultId}" not in live catalog; falling back to default`
    );
  }
  return catalog[0]?.value;
}

/**
 * Order-independent key for the env overrides that influence which models the
 * `claude` CLI advertises — chiefly `ANTHROPIC_MODEL`, which the CLI reflects
 * into its init handshake. Used to scope the catalog cache so editing the
 * override invalidates a stale entry. Mirrors `backendEnvOverridesKey` in
 * `agentMode/index.ts`.
 */
function catalogEnvKey(envOverrides: Record<string, string> | undefined): string {
  const entries = Object.entries(envOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/**
 * Plugin-lifetime cache of the SDK's model catalog, shared across every
 * `ClaudeSdkBackendProcess` instance so opening a chat doesn't re-spawn the
 * `claude` CLI to read the model list. Keyed by the env overrides passed to
 * the probe: editing `ANTHROPIC_MODEL` yields a different key, so the stale
 * entry is ignored and the next `ensureModelCatalog()` re-probes with the new
 * env (the backend is also restarted on the same settings change).
 */
let cachedSdkCatalog: { key: string; models: ModelInfo[] } | null = null;

export function getCachedSdkCatalog(
  envOverrides: Record<string, string> | undefined
): ModelInfo[] | null {
  return cachedSdkCatalog?.key === catalogEnvKey(envOverrides) ? cachedSdkCatalog.models : null;
}

/**
 * Spawn a one-shot SDK `query()` solely to read its initialization
 * handshake — which carries the catalog of models the bundled `claude`
 * CLI advertises (per-model `supportsEffort` + `supportedEffortLevels`).
 *
 * `envOverrides` (the user's Claude env-override box) is merged onto
 * `process.env` for the probe. This is what surfaces a custom
 * `ANTHROPIC_MODEL`: the CLI reflects the override into `init.models` as a
 * first-class entry with full effort metadata, so no synthetic entry is
 * needed and there's a single source of truth.
 *
 * The SDK requires streaming-input mode to expose `initializationResult()`,
 * so we feed it a generator that never yields and tear the query down
 * via `interrupt()` once the handshake completes. Failures resolve to
 * an empty array (logged) so callers can degrade gracefully.
 *
 * Successful, non-empty probes update the module-level cache (keyed by
 * `envOverrides`) so a later `getCachedSdkCatalog()` returns hot data without
 * re-probing.
 */
export async function probeClaudeSdkCatalog(
  pathToClaudeCodeExecutable: string,
  envOverrides?: Record<string, string>
): Promise<ModelInfo[]> {
  // eslint-disable-next-line require-yield
  const noopPrompt = (async function* (): AsyncIterable<SDKUserMessage> {
    await new Promise<void>(() => {});
  })();
  const options: Options = { pathToClaudeCodeExecutable };
  if (envOverrides && Object.keys(envOverrides).length > 0) {
    // Options.env replaces (not merges with) the child env, so include
    // process.env to preserve PATH and friends — same as the prompt path.
    options.env = { ...process.env, ...envOverrides };
  }
  const probe = query({ prompt: noopPrompt, options });
  try {
    const init = await probe.initializationResult();
    if (init.models.length > 0) {
      cachedSdkCatalog = { key: catalogEnvKey(envOverrides), models: init.models };
    }
    return init.models;
  } catch (e) {
    logWarn("[AgentMode] Claude SDK init probe failed", e);
    return [];
  } finally {
    try {
      await probe.interrupt();
    } catch {
      // Probe is being torn down; swallow.
    }
  }
}
