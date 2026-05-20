import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import {
  buildSkillCreationDirective,
  DEFAULT_SKILLS_FOLDER,
  SkillManager,
} from "@/agentMode/skills";

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
    const descriptor = buildSimpleSpawnDescriptor(
      getSettings().agentMode?.backends?.codex?.binaryPath,
      "Codex binary path not configured. Open Agent Mode settings and set the path to codex-acp."
    );
    // Spawn-time skill-creation directive: forwarded into codex's
    // `developer_instructions` config field via codex-acp's `-c key=value`
    // override (see codex's `core/src/config/mod.rs`: "Developer
    // instructions override injected as a separate message"). The value
    // is wrapped in a TOML 1.0 basic string — the `-c` parser runs through
    // TOML, so we escape per the spec rules (`\`, `"`, the named escapes
    // `\b \t \n \f \r`, and remaining controls as `\uXXXX`). Folder is
    // read live from settings so a setting change applies on the next
    // session. See the Skills Management spec.
    const skillsFolder = getSettings().agentMode?.skills?.folder ?? DEFAULT_SKILLS_FOLDER;
    const dirs = Object.values(SkillManager.getInstance().getAgentDirsProjectRel());
    const directive = buildSkillCreationDirective("codex", skillsFolder, dirs);
    descriptor.args = [
      ...descriptor.args,
      "-c",
      `developer_instructions=${toTomlBasicString(directive)}`,
      // Pin spawn-time approval/sandbox so codex-acp's first
      // `currentModeId` report matches the canonical `auto` preset
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
