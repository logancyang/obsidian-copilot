import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";
import { getSettings } from "@/settings/model";
import { detectBinary } from "@/utils/detectBinary";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import type { PlanUsageReading } from "@/agentMode/session/planUsage";
import { defaultCodexHome, readCodexPlanUsage } from "./codexPlanUsage";
import { mergeCodexConfigEnv } from "./codexConfigEnv";
import { buildCodexAcpInvocation, inspectCodexAcpPackage, CODEX_MIN_VERSION } from "./codexVersion";

export class CodexBackend implements AcpBackend {
  readonly id = "codex" as const;
  readonly displayName = "Codex";

  private codexHome: string | null = null;

  constructor(private readonly clientVersion = "") {}

  async buildSpawnDescriptor(ctx: {
    vaultBasePath: string;
    vaultName?: string;
  }): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const descriptor = buildSimpleSpawnDescriptor(
      settings.agentMode?.backends?.codex?.binaryPath,
      "Codex adapter path not configured. Open Agent Mode settings and install or detect @agentclientprotocol/codex-acp.",
      sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.codex?.envOverrides),
      {
        ...(await buildBuiltinSkillEnv(this.clientVersion, ctx.vaultBasePath, ctx.vaultName)),
        // The supported adapter derives its initial ACP mode from this variable.
        // User env overrides still win.
        // The adapter's "read-only" mode asks before each workspace edit, like
        // Default. Start there until a saved picker choice is replayed.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/618
        INITIAL_AGENT_MODE: "read-only",
      }
    );
    const directive = buildAgentSystemPrompt("codex");
    descriptor.env.CODEX_CONFIG = mergeCodexConfigEnv(descriptor.env.CODEX_CONFIG, directive);
    const installed = inspectCodexAcpPackage(descriptor.command);
    const entryPath = installed.entryPath;
    // Native bundles include their runtime; only user-owned npm entries need Node.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    const nodePath =
      process.platform === "win32" && entryPath.endsWith(".js")
        ? await detectBinary("node")
        : undefined;
    const invocation = buildCodexAcpInvocation(
      entryPath,
      descriptor.args,
      descriptor.env,
      process.platform,
      nodePath ?? undefined
    );
    this.codexHome = invocation.env.CODEX_HOME ?? defaultCodexHome();
    assertBinaryCompatible(
      {
        kind: "installed",
        version: installed.runtimeVersion,
        source: settings.agentMode?.backends?.codex?.binarySource ?? "custom",
      },
      CODEX_MIN_VERSION,
      this.displayName
    );
    return { ...descriptor, ...invocation };
  }

  async readPlanUsage(): Promise<PlanUsageReading> {
    return this.codexHome === null ? { kind: "unavailable" } : readCodexPlanUsage(this.codexHome);
  }
}
