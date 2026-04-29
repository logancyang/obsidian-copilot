import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";

/**
 * Spawns the user-provided `codex-acp` binary
 * (`@zed-industries/codex-acp`). The package wraps the local `codex` CLI
 * and exposes it as an ACP server over stdio. Authentication is inherited
 * from the user's existing `codex login` (`~/.codex/auth.json`) or
 * `OPENAI_API_KEY` / `CODEX_API_KEY` exported in the user's shell — we
 * deliberately do not inject keys so ChatGPT-login subscriptions work
 * transparently.
 */
export class CodexBackend implements AcpBackend {
  readonly id = "codex" as const;
  readonly displayName = "Codex";

  async buildSpawnDescriptor(_ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const binaryPath = getSettings().agentMode?.backends?.codex?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "Codex binary path not configured. Open Agent Mode settings and set the path to codex-acp."
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
