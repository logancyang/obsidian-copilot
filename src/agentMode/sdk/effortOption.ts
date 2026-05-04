import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  query,
  type EffortLevel,
  type ModelInfo,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { logWarn } from "@/logger";

/**
 * Build a single-select effort `SessionConfigOption` from a model's
 * advertised `supportedEffortLevels`. Returns `null` when the model
 * doesn't support effort or the SDK reports an empty list.
 *
 * The category is `"thought_level"` (the spec-conformant
 * `SessionConfigOptionCategory` reserved name) so future ACP-aware UIs
 * recognize it; the descriptor's `findEffortConfigOption` also accepts it.
 *
 * Shared between `ClaudeSdkBackendProcess` (per-session synthesis on
 * model switch) and the Claude descriptor's `probeInitialState`
 * (preload-time synthesis from the catalog).
 */
export function synthesizeEffortConfigOption(
  modelInfo: ModelInfo | undefined,
  currentEffort: EffortLevel | undefined
): SessionConfigOption | null {
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
 * Spawn a one-shot SDK `query()` solely to read its initialization
 * handshake — which carries the catalog of models the bundled `claude`
 * CLI advertises (per-model `supportsEffort` + `supportedEffortLevels`).
 *
 * The SDK requires streaming-input mode to expose `initializationResult()`,
 * so we feed it a generator that never yields and tear the query down
 * via `interrupt()` once the handshake completes. Failures resolve to
 * an empty array (logged) so callers can degrade gracefully.
 *
 * Reused by the preloader (descriptor.probeInitialState) and the
 * backend process (lazy fallback when the preload cache is empty).
 */
/**
 * Pick the model id to seed a session with. Honors a persisted preference
 * when it still appears in the live catalog (CLI revs can drop/rename
 * models); falls back to the first catalog entry. Returns `undefined` when
 * the catalog is empty — callers then send no `options.model` and the SDK
 * uses its default.
 */
export function resolveSeedModelId(
  catalog: ModelInfo[],
  preferred: string | undefined
): string | undefined {
  if (preferred && catalog.some((m) => m.value === preferred)) return preferred;
  if (preferred) {
    logWarn(
      `[AgentMode] persisted Claude model "${preferred}" not in live catalog; falling back to default`
    );
  }
  return catalog[0]?.value;
}

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
