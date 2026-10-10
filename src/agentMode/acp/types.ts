import type { BackendId, TurnDiff } from "@/agentMode/session/types";
import type { PlanUsageReading } from "@/agentMode/session/planUsage";

export interface AcpSpawnDescriptor {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
}

export interface AcpBackend {
  readonly id: BackendId;
  readonly displayName: string;
  buildSpawnDescriptor(ctx: {
    vaultBasePath: string;
    vaultName?: string;
  }): Promise<AcpSpawnDescriptor>;
  readPlanUsage?(): Promise<PlanUsageReading>;
  planUsageAppliesTo?(wireModelId: string | null | undefined): boolean;
  readContextWindow?(wireModelId: string | null | undefined): Promise<number | null>;
  readonly clientCapabilitiesMeta?: Readonly<Record<string, unknown>>;
  readTurnDiff?(
    promptResultMeta: Readonly<Record<string, unknown>> | null | undefined
  ): TurnDiff | null;
  readOriginalFiles?(rawOutput: unknown): Readonly<Record<string, string | null>> | undefined;
}
