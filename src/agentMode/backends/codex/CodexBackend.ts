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
import { buildCodexAcpInvocation, resolveSupportedCodexAcpEntry } from "./codexVersion";

/**
 * Spawns the configured `@agentclientprotocol/codex-acp` package entry point.
 * The package exposes Codex as an ACP server over stdio. Authentication is inherited
 * from the adapter's bundled Codex login (`~/.codex/auth.json`) or
 * `OPENAI_API_KEY` / `CODEX_API_KEY` exported in the user's shell — we
 * deliberately do not inject keys so ChatGPT-login subscriptions work
 * transparently.
 */
export class CodexBackend implements AcpBackend {
  readonly id = "codex" as const;
  readonly displayName = "Codex";

  /**
   * Where the spawned Codex keeps its state, taken from the env we actually gave it so a
   * user who redirects `CODEX_HOME` has their caps read from the same place Codex writes
   * them. Null until the first spawn, because until then there is no Codex to read from.
   */
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
        // Builtin skills consume plugin-managed runtime paths and credentials.
        ...(await buildBuiltinSkillEnv(this.clientVersion, ctx.vaultBasePath, ctx.vaultName)),
        // The supported adapter derives its initial ACP mode from this variable.
        // User env overrides still win.
        INITIAL_AGENT_MODE: "agent",
      }
    );
    // Forward the shared built-in prompt — the Copilot base framing, tool
    // guidance, and pill-syntax directive — through the current adapter's
    // CODEX_CONFIG JSON. Codex appends `developer_instructions` to its own base
    // prompt, so this adds the Obsidian-vault framing on top. Read at spawn
    // time; the host restarts Codex on prompt changes via
    // `restartOnSystemPromptChange`.
    const directive = buildAgentSystemPrompt();
    descriptor.env.CODEX_CONFIG = mergeCodexConfigEnv(descriptor.env.CODEX_CONFIG, directive);
    // Deliberately no `project_doc_fallback_filenames=["project.md"]`: project.md is metadata,
    // while Codex discovers the canonical AGENTS.md instructions from the session cwd.
    const entryPath = resolveSupportedCodexAcpEntry(descriptor.command);
    const nodePath = process.platform === "win32" ? await detectBinary("node") : undefined;
    const invocation = buildCodexAcpInvocation(
      entryPath,
      descriptor.args,
      descriptor.env,
      process.platform,
      nodePath ?? undefined
    );
    this.codexHome = invocation.env.CODEX_HOME ?? defaultCodexHome();
    return { ...descriptor, ...invocation };
  }

  /**
   * Codex's caps, read back from the rollout it writes for every turn. See
   * `codexPlanUsage.ts` for why that file is the only structured source a client has.
   * Before the first spawn there is no Codex to read from, so there is no news yet.
   */
  async readPlanUsage(): Promise<PlanUsageReading> {
    return this.codexHome === null ? { kind: "unavailable" } : readCodexPlanUsage(this.codexHome);
  }
}
