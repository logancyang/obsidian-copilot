import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";

/**
 * Spawns the user-provided `claude-agent-acp` binary
 * (`@agentclientprotocol/claude-agent-acp`). The package wraps the local
 * `claude` CLI and exposes it as an ACP server over stdio. Authentication is
 * inherited from `~/.claude/` — the user logs in with `claude auth login`
 * outside the plugin and we just spawn the adapter; we deliberately do not
 * pass `ANTHROPIC_API_KEY` so subscription accounts work transparently.
 *
 * Unlike OpenCode, Claude Code does not consume Copilot's `activeModels` or
 * BYOK keys; its model list comes entirely from the agent's own
 * `availableModels` stream (live or preloader-cached).
 */
export class ClaudeCodeBackend implements AcpBackend {
  readonly id = "claude-code" as const;
  readonly displayName = "Claude Code";

  async buildSpawnDescriptor(_ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const binaryPath = getSettings().agentMode?.backends?.["claude-code"]?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "Claude Code binary path not configured. Open Agent Mode settings and set the path to claude-agent-acp."
      );
    }
    return {
      command: binaryPath,
      args: [],
      env: {
        ...process.env,
        PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
      },
    };
  }
}
