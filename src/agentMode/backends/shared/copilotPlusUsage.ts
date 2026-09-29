import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import { planUsageReading, toUsagePercent } from "@/agentMode/session/planUsage";
import { BrevilabsClient, type UsageResponse } from "@/LLMProviders/brevilabsClient";
import { getSettings } from "@/settings/model";

const COPILOT_PLUS_WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ["five_hour", "5h"],
  ["weekly", "Weekly"],
];

function epochSecondsToMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1000);
}

// The endpoint omits an uncapped window and also returns no windows when counters cannot be
// read; the two are indistinguishable, so an absent window never clears the meters.
// https://github.com/logancyang/obsidian-copilot-preview/issues/193
export function planUsageFromCopilotPlusUsage(
  snapshot: UsageResponse | null | undefined,
  now: number = Date.now()
): PlanUsageReading {
  const used = snapshot?.used;
  if (!used) return { kind: "unavailable" };

  const windows: UsageWindow[] = [];
  for (const [id, label] of COPILOT_PLUS_WINDOWS) {
    const raw = used[id];
    const percent = toUsagePercent(raw?.usedPercent);
    if (percent === null) continue;
    windows.push({ id, label, percent, resetsAt: epochSecondsToMs(raw?.resetsAt) });
  }

  return planUsageReading(windows, now);
}

export class CopilotPlusUsageReader {
  async readPlanUsage(): Promise<PlanUsageReading> {
    const snapshot = await BrevilabsClient.getInstance().getUsage();
    return planUsageFromCopilotPlusUsage(snapshot);
  }

  // Read from the cached lineup so the window always agrees with the model row the agent was
  // configured from.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  async readContextWindow(modelId: string | null): Promise<number | null> {
    if (!modelId) return null;
    const model = getSettings().copilotPlusCatalog.models.find((m) => m.id === modelId);
    return model?.limits?.context ?? null;
  }
}
