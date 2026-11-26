import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { resolveCursorBinary, type CursorBinaryResolverInput } from "./cursorBinaryResolver";

const NOT_SET_UP =
  "Cursor isn't set up. Install it or choose Auto-detect in Settings → Copilot → Basic → Agents.";

export function cursorResolverEnv(): Omit<CursorBinaryResolverInput, "override"> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  };
}

export class CursorBackend implements AcpBackend {
  readonly id = "cursor" as const;
  readonly displayName = "Cursor";

  constructor(private readonly clientVersion = "") {}

  async buildSpawnDescriptor(): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const binaryPath = resolveCursorBinary({
      override: settings.agentMode?.backends?.cursor?.binaryPath,
      ...cursorResolverEnv(),
    });
    const descriptor = buildSimpleSpawnDescriptor(
      binaryPath ?? undefined,
      NOT_SET_UP,
      sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.cursor?.envOverrides),
      await buildBuiltinSkillEnv(this.clientVersion)
    );
    return { ...descriptor, args: ["acp"] };
  }
}
