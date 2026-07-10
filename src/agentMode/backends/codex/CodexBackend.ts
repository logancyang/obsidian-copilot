import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildCopilotPlusEnv } from "@/agentMode/backends/shared/copilotPlusEnv";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { getSettings } from "@/settings/model";
import { launcherForConfiguredPath } from "./CodexBinaryManager";

const DEFAULT_AGENT_MODE = "agent";

export interface CodexBackendDependencies {
  platform?: NodeJS.Platform;
  nodePath?: string;
}

/**
 * Spawns the user-provided `@agentclientprotocol/codex-acp` launcher. The
 * adapter inherits ChatGPT login and API-key authentication from Codex's
 * normal environment; Copilot only supplies its session configuration and
 * initial permission preset.
 */
export class CodexBackend implements AcpBackend {
  readonly id = "codex" as const;
  readonly displayName = "Codex";

  private readonly platform: NodeJS.Platform;
  private readonly nodePath: string | undefined;

  constructor(deps: CodexBackendDependencies = {}) {
    this.platform = deps.platform ?? process.platform;
    this.nodePath = deps.nodePath;
  }

  async buildSpawnDescriptor(_ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const settings = getSettings().agentMode?.backends?.codex;
    const descriptor = buildSimpleSpawnDescriptor(
      settings?.binaryPath,
      "Codex binary path not configured. Open Agent Mode settings and set the path to codex-acp.",
      settings?.envOverrides,
      await buildCopilotPlusEnv()
    );
    const launcher = launcherForConfiguredPath(descriptor.command, this.platform, this.nodePath);

    descriptor.command = launcher.command;
    descriptor.args = launcher.args;
    descriptor.env.CODEX_CONFIG = buildCodexConfig(
      descriptor.env.CODEX_CONFIG,
      buildAgentSystemPrompt()
    );
    descriptor.env.INITIAL_AGENT_MODE = DEFAULT_AGENT_MODE;
    return descriptor;
  }
}

function buildCodexConfig(existing: string | undefined, developerInstructions: string): string {
  let config: Record<string, unknown> = {};
  if (existing) {
    const parsed: unknown = JSON.parse(existing);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("CODEX_CONFIG must be a JSON object.");
    }
    config = parsed as Record<string, unknown>;
  }
  return JSON.stringify({ ...config, developer_instructions: developerInstructions });
}
