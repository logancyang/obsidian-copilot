import { getSettings } from "@/settings/model";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";

export class AntigravityBackend implements AcpBackend {
  readonly id = "antigravity" as const;
  readonly displayName = "Antigravity";

  constructor(private readonly clientVersion = "") {}

  async buildSpawnDescriptor(ctx: {
    vaultBasePath: string;
    vaultName?: string;
  }): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const descriptor = buildSimpleSpawnDescriptor(
      settings.agentMode?.backends?.antigravity?.binaryPath,
      "Antigravity binary path not configured.",
      sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.antigravity?.envOverrides),
      {
        ...(await buildBuiltinSkillEnv(this.clientVersion, ctx.vaultBasePath, ctx.vaultName)),
        INITIAL_AGENT_MODE: "agent",
      }
    );

    descriptor.env.ANTIGRAVITY_SYSTEM_PROMPT = buildAgentSystemPrompt();
    return descriptor;
  }
}
