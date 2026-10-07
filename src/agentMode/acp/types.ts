import type { BackendId } from "@/agentMode/session/types";
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
  failureCauseFromLog?(stderrLine: string): string | null;
}
