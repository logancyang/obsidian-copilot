import type { App } from "obsidian";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import {
  planUsageReading,
  type PlanUsage,
  type PlanUsageReading,
} from "@/agentMode/session/planUsage";
import { getSettings } from "@/settings/model";
import { resolveAntigravityBinaryPath } from "./antigravityCli";
import { readAntigravityCopilotTools } from "./antigravityCopilotToolCalls";
import {
  planUsageForModel,
  readAntigravityQuotaGroups,
  type AntigravityQuotaGroup,
} from "./antigravityPlanUsage";

export const ANTIGRAVITY_NOT_SET_UP_MESSAGE =
  "Antigravity isn't set up. Install the Antigravity CLI (agy), then detect it in Settings → Copilot → Basic → Agents.";

const USAGE_READ_INTERVAL_MS = 60_000;
const USAGE_MAX_BACKOFF_MS = 30 * 60_000;

export class AntigravityBackend implements AcpBackend {
  readonly id = "antigravity" as const;
  readonly displayName = "Antigravity";
  readonly readCopilotTools = readAntigravityCopilotTools;
  readonly synthesizesManualCompaction = true;
  readonly reopensWithResume = true;

  private spawned: AcpSpawnDescriptor | null = null;
  private quotaGroups: ReadonlyArray<AntigravityQuotaGroup> = [];
  private lastUsageReading: PlanUsageReading = { kind: "unavailable" };
  private nextUsageReadAt = 0;
  private failedUsageReads = 0;

  constructor(
    private readonly app: App,
    private readonly clientVersion = ""
  ) {}

  async buildSpawnDescriptor(): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const descriptor = buildSimpleSpawnDescriptor(
      resolveAntigravityBinaryPath(settings) ?? undefined,
      ANTIGRAVITY_NOT_SET_UP_MESSAGE,
      sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.antigravity?.envOverrides),
      await buildBuiltinSkillEnv(this.clientVersion)
    );
    this.spawned = { ...descriptor, args: ["acp", "--process-per-session"] };
    return this.spawned;
  }

  newSessionMeta(): Record<string, unknown> {
    return {
      antigravity: { systemPrompt: { append: buildAgentSystemPrompt(this.id, this.app) } },
    };
  }

  async readPlanUsage(signal?: AbortSignal): Promise<PlanUsageReading> {
    if (!this.spawned || Date.now() < this.nextUsageReadAt) return this.lastUsageReading;
    const groups = await readAntigravityQuotaGroups(this.spawned.command, this.spawned.env, signal);
    if (!groups) {
      this.failedUsageReads++;
      this.nextUsageReadAt =
        Date.now() +
        Math.min(USAGE_READ_INTERVAL_MS * 2 ** this.failedUsageReads, USAGE_MAX_BACKOFF_MS);
      return { kind: "unavailable" };
    }
    this.failedUsageReads = 0;
    this.nextUsageReadAt = Date.now() + USAGE_READ_INTERVAL_MS;
    this.quotaGroups = groups;
    this.lastUsageReading = planUsageReading(groups.flatMap((group) => group.windows));
    return this.lastUsageReading;
  }

  selectPlanUsage(planUsage: PlanUsage, wireModelId: string | null | undefined): PlanUsage | null {
    return planUsageForModel(planUsage, this.quotaGroups, wireModelId);
  }
}
