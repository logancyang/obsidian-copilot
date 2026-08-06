import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildBuiltinSkillEnv } from "@/agentMode/backends/shared/builtinSkillEnv";
import { codexAcpInvocation } from "./codexBinaryResolver";
import { buildCodexEnvironment, probeCodexAcpCompatibility } from "./codexCompatibility";
import { mergeCodexConfigEnv } from "./codexConfigEnv";

/**
 * Spawns the user-provided `codex-acp` binary. The package exposes Codex as
 * an ACP server over stdio. Authentication is inherited
 * from the user's existing `codex login` (`~/.codex/auth.json`) or
 * `OPENAI_API_KEY` / `CODEX_API_KEY` exported in the user's shell — we
 * deliberately do not inject keys so ChatGPT-login subscriptions work
 * transparently.
 */
export class CodexBackend implements AcpBackend {
  readonly id = "codex" as const;
  readonly displayName = "Codex";

  async buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const codexSettings = getSettings().agentMode?.backends?.codex;
    const binaryPath = codexSettings?.binaryPath;
    const descriptor = buildSimpleSpawnDescriptor(
      binaryPath,
      "Codex binary path not configured. Open Agent Mode settings and set the path to codex-acp.",
      codexSettings?.envOverrides,
      {
        // Builtin skills consume plugin-managed runtime paths and credentials.
        ...(await buildBuiltinSkillEnv("", ctx.vaultBasePath)),
        // Newer adapters derive the initial ACP mode from this variable rather
        // than Codex's approval/sandbox config. User env overrides still win.
        INITIAL_AGENT_MODE: "agent",
      }
    );
    descriptor.env = buildCodexEnvironment(
      descriptor.command,
      descriptor.env,
      codexSettings?.envOverrides
    );
    const compatibility = await probeCodexAcpCompatibility(
      descriptor.command,
      undefined,
      process.platform,
      descriptor.env
    );
    if (compatibility.kind !== "ready") {
      throw new Error(
        compatibility.kind === "error"
          ? compatibility.message
          : `Codex is not ready (${compatibility.kind}).`
      );
    }
    const invocation = codexAcpInvocation(descriptor.command);
    descriptor.command = invocation.command;
    descriptor.args = invocation.args;
    // Forward the shared composed system prompt — the Copilot base framing
    // (unless the user disabled it), the pill-syntax directive, and the user's
    // custom prompt — via codex's `developer_instructions` config field.
    // codex appends it to its own base prompt. Read at spawn time; the host
    // restarts codex on prompt changes via `restartOnSystemPromptChange`.
    const directive = buildAgentSystemPrompt();
    descriptor.env.CODEX_CONFIG = mergeCodexConfigEnv(descriptor.env.CODEX_CONFIG, directive);
    // DESIGN NOTE: deliberately no `project_doc_fallback_filenames=["project.md"]`.
    // Post-Phase-2 the session-start `ensureAgentsMirror` (AgentSessionManager, run before
    // `resolveSessionCwd` for codex/opencode project sessions) guarantees the marker'd
    // `AGENTS.md` mirror exists in the project cwd, so a `project.md` fallback is redundant.
    // This descriptor only knows `vaultBasePath`, not the session scope: a spawn-level fallback
    // would also apply to GLOBAL sessions and let codex read a user's vault-root `project.md`
    // note as instructions. On the rare ensure failure a project session gets no instructions
    // (ensure never throws and re-runs next session) rather than the frontmatter-laden source.
    return descriptor;
  }
}
