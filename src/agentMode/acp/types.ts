import type { BackendId, TurnDiff } from "@/agentMode/session/types";
import type { PlanUsage, PlanUsageReading } from "@/agentMode/session/planUsage";
import type { CopilotToolUse } from "@/agentMode/session/copilotToolCalls";

export interface AcpSpawnDescriptor {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
}

export interface AcpBackend {
  readonly id: BackendId;
  readonly displayName: string;
  buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor>;
  readPlanUsage?(signal?: AbortSignal): Promise<PlanUsageReading>;
  planUsageAppliesTo?(wireModelId: string | null | undefined): boolean;
  selectPlanUsage?(planUsage: PlanUsage, wireModelId: string | null | undefined): PlanUsage | null;
  readContextWindow?(wireModelId: string | null | undefined): Promise<number | null>;
  readonly clientCapabilitiesMeta?: Readonly<Record<string, unknown>>;
  newSessionMeta?(): Record<string, unknown>;
  readonly synthesizesManualCompaction?: boolean;
  readonly reopensWithResume?: boolean;
  readTurnDiff?(
    promptResultMeta: Readonly<Record<string, unknown>> | null | undefined
  ): TurnDiff | null;
  readCopilotTools?(rawInput: unknown, toolName?: string): CopilotToolUse | null;
}
