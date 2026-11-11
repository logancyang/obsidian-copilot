import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { getSettings } from "@/settings/model";
import { resolveAntigravityBinaryPath } from "./antigravityCli";

export const ANTIGRAVITY_NOT_SET_UP_MESSAGE =
  "Antigravity isn't set up. Install the Antigravity CLI (agy), then detect it in Settings → Copilot → Basic → Agents.";

export class AntigravityBackend implements AcpBackend {
  readonly id = "antigravity" as const;
  readonly displayName = "Antigravity";

  constructor(private readonly clientVersion = "") {}

  async buildSpawnDescriptor(): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const descriptor = buildSimpleSpawnDescriptor(
      resolveAntigravityBinaryPath(settings) ?? undefined,
      ANTIGRAVITY_NOT_SET_UP_MESSAGE,
      sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.antigravity?.envOverrides),
      await buildBuiltinSkillEnv(this.clientVersion)
    );
    return { ...descriptor, args: ["acp"] };
  }
}
