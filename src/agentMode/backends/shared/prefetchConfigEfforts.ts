import { logWarn } from "@/logger";
import type { BackendDescriptor, EffortOption } from "@/agentMode/session/types";

const EMPTY_EFFORT_CATALOG: Record<string, EffortOption[]> = Object.freeze({});

export async function prefetchConfigEfforts({
  proc,
  sessionId,
  modelState,
  enabledModels,
  isAborted,
}: Parameters<NonNullable<BackendDescriptor["prefetchEffortCatalog"]>>[0]): Promise<
  Record<string, EffortOption[]>
> {
  // Config catalogs expose effort only for the active model, including Codex.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/550
  if (modelState.apply.kind !== "setConfigOption") return EMPTY_EFFORT_CATALOG;
  const configId = modelState.apply.configId;
  const originalWire = modelState.current.baseModelId;
  const originalEffort = modelState.current.effort;
  const originalEffortConfigId = modelState.apply.effortConfigId;
  const out: Record<string, EffortOption[]> = {};
  let restorationError: Error | undefined;
  try {
    for (const model of enabledModels) {
      if (isAborted()) break;
      if (model.credentialState !== "ok") continue;
      try {
        const next = await proc.setSessionConfigOption({
          sessionId,
          configId,
          value: model.baseModelId,
        });
        const entry = next.model?.availableModels.find((e) => e.baseModelId === model.baseModelId);
        if (entry && next.model?.current.baseModelId === model.baseModelId) {
          out[model.baseModelId] = entry.effortOptions;
        }
      } catch (e) {
        logWarn(`[AgentMode] effort prefetch for ${model.baseModelId} failed`, e);
      }
    }
  } finally {
    try {
      await proc.setSessionConfigOption({ sessionId, configId, value: originalWire });
      if (originalEffort !== null && originalEffortConfigId) {
        await proc.setSessionConfigOption({
          sessionId,
          configId: originalEffortConfigId,
          value: originalEffort,
        });
      }
    } catch (e) {
      logWarn("[AgentMode] effort prefetch: restore failed", e);
      restorationError = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (restorationError) throw restorationError;
  return Object.keys(out).length > 0 ? out : EMPTY_EFFORT_CATALOG;
}
