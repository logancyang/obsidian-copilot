import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildBuiltinSkillEnv } from "@/agentMode/backends/shared/builtinSkillEnv";
import { codexAcpInvocation } from "./codexBinaryResolver";
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
    const binaryPath = getSettings().agentMode?.backends?.codex?.binaryPath;
    const descriptor = buildSimpleSpawnDescriptor(
      binaryPath,
      "Codex binary path not configured. Open Agent Mode settings and set the path to codex-acp.",
      getSettings().agentMode?.backends?.codex?.envOverrides,
      {
        // Builtin skills consume plugin-managed runtime paths and credentials.
        ...(await buildBuiltinSkillEnv("", ctx.vaultBasePath)),
        // Newer adapters derive the initial ACP mode from this variable rather
        // than Codex's approval/sandbox config. User env overrides still win.
        INITIAL_AGENT_MODE: "agent",
      }
    );
    const invocation = codexAcpInvocation(descriptor.command);
    descriptor.command = invocation.command;
    descriptor.args = invocation.args;
    // Forward the shared composed system prompt — the Copilot base framing
    // (unless the user disabled it), the pill-syntax directive, and the user's
    // custom prompt — via codex's `developer_instructions` config field as a
    // TOML 1.0 basic string. codex appends `developer_instructions` to its own
    // base prompt, so this adds the Obsidian-vault framing on top. Read at
    // spawn time; the host restarts codex on prompt changes via
    // `restartOnSystemPromptChange`.
    const directive = buildAgentSystemPrompt();
    // Current @agentclientprotocol/codex-acp server mode ignores arbitrary
    // argv and merges CODEX_CONFIG into every session. Keep the argv path
    // below for legacy @zed-industries/codex-acp versions.
    descriptor.env.CODEX_CONFIG = mergeCodexConfigEnv(descriptor.env.CODEX_CONFIG, directive);
    descriptor.args = [
      ...descriptor.args,
      "-c",
      `developer_instructions=${toTomlBasicString(directive)}`,
      // Pin spawn-time approval/sandbox so legacy codex-acp's first
      // `currentModeId` report matches its canonical `auto` preset
      // (workspace-write + on-request), which Agent Mode surfaces as
      // canonical `default` (ask mode). Without this, codex-acp derives
      // the initial mode from the user's `~/.codex/config.toml` defaults
      // (often `read-only` for untrusted projects), causing the picker
      // to briefly show "Plan" before our post-spawn coerce switches it
      // — see the matching `auto` preset in codex-utils-approval-presets
      // and `Thread::modes()` in codex-acp/src/thread.rs.
      "-c",
      'approval_policy="on-request"',
      "-c",
      'sandbox_mode="workspace-write"',
    ];
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

/**
 * Encode `value` as a TOML 1.0 basic string (double-quoted). Escapes:
 *   - `\` and `"`
 *   - named escapes `\b \t \n \f \r`
 *   - any other byte in 0x00–0x1F and 0x7F as `\uXXXX`
 *
 * Non-ASCII characters above 0x7F are valid in basic strings and pass
 * through unescaped. Exported for unit testing.
 */
export function toTomlBasicString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch === 0x5c) out += "\\\\";
    else if (ch === 0x22) out += '\\"';
    else if (ch === 0x08) out += "\\b";
    else if (ch === 0x09) out += "\\t";
    else if (ch === 0x0a) out += "\\n";
    else if (ch === 0x0c) out += "\\f";
    else if (ch === 0x0d) out += "\\r";
    else if (ch < 0x20 || ch === 0x7f) {
      out += "\\u" + ch.toString(16).padStart(4, "0");
    } else {
      out += value[i];
    }
  }
  out += '"';
  return out;
}
