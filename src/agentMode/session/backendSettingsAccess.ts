import type { CopilotSettings } from "@/settings/model";
import type { BackendId } from "./types";

interface BackendSliceWithOverrides {
  modelEnabledOverrides?: Record<string, boolean>;
}

/**
 * `undefined` means "no overrides written" — callers should fall back to the
 * descriptor's default policy.
 */
export function getBackendModelOverrides(
  settings: CopilotSettings,
  backendId: BackendId
): Record<string, boolean> | undefined {
  const backends = settings.agentMode?.backends as
    | Record<string, BackendSliceWithOverrides | undefined>
    | undefined;
  return backends?.[backendId]?.modelEnabledOverrides;
}
