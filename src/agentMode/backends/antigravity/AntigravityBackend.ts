import { getSettings } from "@/settings/model";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import type { PlanUsageReading } from "@/agentMode/session/planUsage";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { resolveDefaultAgyCliBinary } from "./antigravityBinaryResolver";

/**
 * Spawns the `agy-acp` adapter binary. Antigravity models are powered by
 * Google Antigravity and billed/authorized through the user's Google account session.
 */
export class AntigravityBackend implements AcpBackend {
  readonly id = "antigravity" as const;
  readonly displayName = "Antigravity";
  readonly shouldRouteAgentMessageText = undefined;

  constructor(private readonly clientVersion = "") {}

  async buildSpawnDescriptor(ctx: {
    vaultBasePath: string;
    vaultName?: string;
  }): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const envOverrides =
      sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.antigravity?.envOverrides) ??
      {};

    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const os = requireNodeModule<typeof import("node:os")>("os");

    const baseEnv: Record<string, string> = {
      ...(await buildBuiltinSkillEnv(this.clientVersion, ctx.vaultBasePath, ctx.vaultName)),
      INITIAL_AGENT_MODE: "agent",
    };

    if (!envOverrides.AGY_BIN) {
      const defaultAgy = resolveDefaultAgyCliBinary({
        homeDir: os.homedir(),
        platform: process.platform,
        env: process.env,
        fs: {
          existsSync: (p) => fs.existsSync(p),
          readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
          readdirSync: (p) => fs.readdirSync(p),
        },
      });
      if (defaultAgy) {
        baseEnv.AGY_BIN = defaultAgy;
      }
    }

    const descriptor = buildSimpleSpawnDescriptor(
      settings.agentMode?.backends?.antigravity?.binaryPath,
      "Antigravity adapter binary path not configured. Open Agent Mode settings and set the path to agy-acp.",
      envOverrides,
      baseEnv
    );

    return descriptor;
  }

  async readPlanUsage(): Promise<PlanUsageReading> {
    return { kind: "unavailable" };
  }
}
