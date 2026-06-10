import type { BackendConfigOption } from "@/agentMode/session/types";
import {
  query,
  type EffortLevel,
  type ModelInfo,
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
 * The env var the `claude` CLI reads to override which model it talks to.
 * When a user sets it in the Claude backend's env overrides, we surface its
 * value as a synthetic catalog entry so the model becomes pickable.
 */
export const CUSTOM_MODEL_ENV_KEY = "ANTHROPIC_MODEL";

/**
 * Build a synthetic `ModelInfo` for a user-declared custom model id taken from
 * the `ANTHROPIC_MODEL` env override, or `null` when the override is unset or
 * blank. The id is its own display name; effort fields stay unset (the SDK
 * advertises none for an unknown model, so no effort option is synthesized).
 */
export function customModelFromEnv(
  envOverrides: Record<string, string> | undefined
): ModelInfo | null {
  const id = envOverrides?.[CUSTOM_MODEL_ENV_KEY]?.trim();
  if (!id) return null;
  return {
    value: id,
    displayName: id,
    description: `Custom model from ${CUSTOM_MODEL_ENV_KEY}`,
  };
}

/**
 * Append a custom model to the SDK catalog so it flows through model discovery
 * and the picker. Returns the catalog unchanged (same reference) when there's
 * no custom model or it already shadows a real catalog entry by `value`, so a
 * custom id matching a built-in never double-lists.
 */
export function mergeCustomModel(catalog: ModelInfo[], custom: ModelInfo | null): ModelInfo[] {
  if (!custom || catalog.some((m) => m.value === custom.value)) return catalog;
  return [...catalog, custom];
}

/**
 * Plugin-lifetime cache of the SDK's model catalog, shared across every
 * `ClaudeSdkBackendProcess` instance so opening a chat doesn't re-spawn
 * the `claude` CLI to read the model list.
 */
let cachedSdkCatalog: ModelInfo[] | null = null;

export function getCachedSdkCatalog(): ModelInfo[] | null {
  return cachedSdkCatalog;
}

/**
 * Spawn a one-shot SDK `query()` solely to read its initialization
 * handshake — which carries the catalog of models the bundled `claude`
 * CLI advertises (per-model `supportsEffort` + `supportedEffortLevels`).
 *
 * The SDK requires streaming-input mode to expose `initializationResult()`,
 * so we feed it a generator that never yields and tear the query down
 * via `interrupt()` once the handshake completes. Failures resolve to
 * an empty array (logged) so callers can degrade gracefully.
 *
 * Successful, non-empty probes update the module-level cache so a later
 * `getCachedSdkCatalog()` returns hot data without re-probing.
 */
export async function probeClaudeSdkCatalog(
  pathToClaudeCodeExecutable: string
): Promise<ModelInfo[]> {
  // eslint-disable-next-line require-yield
  const noopPrompt = (async function* (): AsyncIterable<SDKUserMessage> {
    await new Promise<void>(() => {});
  })();
  const probe = query({
    prompt: noopPrompt,
    options: { pathToClaudeCodeExecutable },
  });
  try {
    const init = await probe.initializationResult();
    if (init.models.length > 0) cachedSdkCatalog = init.models;
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
