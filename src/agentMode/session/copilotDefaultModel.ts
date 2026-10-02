import type { BackendDescriptor, BackendId } from "./types";
import { type CopilotSettings, getSettings, setSettings } from "@/settings/model";

type BackendRow = NonNullable<CopilotSettings["backends"][keyof CopilotSettings["backends"]]>;

export function seedCopilotDefaultModel(
  descriptors: readonly BackendDescriptor[],
  configuredModelId: string
): BackendId[] {
  const settings = getSettings();
  const targets = descriptors
    .filter((descriptor) => descriptor.getWireBaseId?.(configuredModelId, settings))
    .map((descriptor) => descriptor.id);
  if (targets.length === 0) return [];

  setSettings((cur: CopilotSettings) => {
    const backends = { ...cur.backends } as Record<string, BackendRow>;
    for (const backendId of targets) {
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
