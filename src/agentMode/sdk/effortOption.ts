import { resolveEffort } from "@/lib/model-effort";
import type { BackendConfigOption } from "@/agentMode/session/types";
import {
  query,
  type EffortLevel,
  type ModelInfo,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { logWarn } from "@/logger";

export function synthesizeEffortConfigOption(
  modelInfo: ModelInfo | undefined,
  currentEffort: EffortLevel | undefined
): BackendConfigOption | null {
  const levels = modelInfo?.supportsEffort ? (modelInfo.supportedEffortLevels ?? []) : [];
  if (levels.length === 0) return null;
  const value = resolveEffort(
    currentEffort,
    levels.map((value) => ({ value, label: value }))
  )!;
  return {
    id: "effort",
    type: "select",
    category: "thought_level",
    name: "Effort",
    currentValue: value,
    options: levels.map((v) => ({ value: v, name: v })),
  };
}

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

function catalogEnvKey(envOverrides: Record<string, string> | undefined): string {
  const entries = Object.entries(envOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

let cachedSdkCatalog: { key: string; models: ModelInfo[] } | null = null;

export function getCachedSdkCatalog(
  envOverrides: Record<string, string> | undefined
): ModelInfo[] | null {
  return cachedSdkCatalog?.key === catalogEnvKey(envOverrides) ? cachedSdkCatalog.models : null;
}

export async function probeClaudeSdkCatalog(
  pathToClaudeCodeExecutable: string,
  envOverrides?: Record<string, string>
): Promise<ModelInfo[]> {
  // eslint-disable-next-line require-yield -- the async generator matches the SDK hook contract without yielding
  const noopPrompt = (async function* (): AsyncIterable<SDKUserMessage> {
    await new Promise<void>(() => {});
  })();
  const options: Options = { pathToClaudeCodeExecutable };
  if (envOverrides && Object.keys(envOverrides).length > 0) {
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
