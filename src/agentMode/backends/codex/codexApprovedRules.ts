import type { ApprovedRule, ApprovedRuleStore } from "@/agentMode/session/types";
import { sanitizeBuiltinSkillEnvOverrides } from "@/agentMode/backends/shared/builtinSkillEnv";
import { oneAtATime } from "@/agentMode/backends/shared/oneAtATime";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { codexCliInvocation } from "./codexAuth";
import type { CodexAcpInvocation } from "./codexVersion";

const CHECK_TIMEOUT_MS = 30_000;
const ANY_COMMAND = "true";

// Codex saves each "always" grant as one line in exactly these forms (codex-rs execpolicy
// amend.rs); multi-line, single-quoted, or other-decision rules were written by a person and stay
// off the page. https://github.com/Brevilabs/obsidian-copilot-private/issues/868
const EXEC_GRANT = /^prefix_rule\(pattern=(\[.*\]), decision="allow"\)$/;
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const NETWORK_GRANT = new RegExp(
  String.raw`^network_rule\(host=(${JSON_STRING}), protocol=(${JSON_STRING}), decision="allow"(?:, justification=${JSON_STRING})?\)$`
);

function fs(): typeof import("node:fs").promises {
  return requireNodeModule<typeof import("node:fs")>("fs").promises;
}

function path(): typeof import("node:path") {
  return requireNodeModule<typeof import("node:path")>("path");
}

function os(): typeof import("node:os") {
  return requireNodeModule<typeof import("node:os")>("os");
}

function rulesFile(): string {
  const env = {
    ...process.env,
    ...sanitizeBuiltinSkillEnvOverrides(getSettings().agentMode?.backends?.codex?.envOverrides),
  };
  // Without CODEX_HOME, Codex uses the HOME it runs with, which its env overrides can change;
  // Windows Codex reads the profile folder instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/868
  const home = (process.platform !== "win32" && env.HOME) || os().homedir();
  return path().join(env.CODEX_HOME || path().join(home, ".codex"), "rules", "default.rules");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function shellWord(token: string): string {
  return /^[\w@%+=:,./-]+$/.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`;
}

function describeGrant(line: string): string | null {
  const exec = EXEC_GRANT.exec(line);
  if (exec) {
    const pattern = parseJson(exec[1]);
    return Array.isArray(pattern) && pattern.every((token) => typeof token === "string")
      ? pattern.map(shellWord).join(" ")
      : null;
  }
  const network = NETWORK_GRANT.exec(line);
  if (!network) return null;
  const host = parseJson(network[1]);
  const protocol = parseJson(network[2]);
  return typeof host === "string" && typeof protocol === "string"
    ? `Network access to ${host} (${protocol})`
    : null;
}

async function checkRules(codex: CodexAcpInvocation, text: string, file: string): Promise<void> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const dir = await fs().mkdtemp(path().join(os().tmpdir(), "copilot-codex-rules-"));
  const copy = path().join(dir, "default.rules");
  await fs().writeFile(copy, text);
  await new Promise<void>((resolve, reject) => {
    execFile(
      codex.command,
      [...codex.args, "execpolicy", "check", "--rules", copy, ANY_COMMAND],
      { env: codex.env, timeout: CHECK_TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) =>
        error
          ? reject(
              new Error(
                `Codex couldn't read the rules file without it, so the file was left as it was. ${String(stderr).trim().replaceAll(copy, file) || error.message}`
              )
            )
          : resolve()
    );
  }).finally(() => fs().rm(dir, { recursive: true, force: true }));
}

export const codexApprovedRules: ApprovedRuleStore = {
  list() {
    return oneAtATime(async () => {
      const file = rulesFile();
      const text = await fs()
        .readFile(file, "utf8")
        .catch((error: NodeJS.ErrnoException) => {
          // Codex creates the rules file only when it saves its first grant.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/868
          if (error.code === "ENOENT") return "";
          throw error;
        });
      return text.split("\n").flatMap((line): ApprovedRule[] => {
        const allows = describeGrant(line);
        return allows === null
          ? []
          : [{ id: line, allows, appliesTo: { kind: "file", path: file } }];
      });
    });
  },

  remove(_plugin, rule) {
    return oneAtATime(async () => {
      const file = (rule.appliesTo as { path: string }).path;
      const codex = await codexCliInvocation(
        getSettings(),
        "Install Codex before removing its approved rules."
      );
      const withoutRule = async () => {
        const lines: string[] = (await fs().readFile(file, "utf8")).match(/[^\n]*\n|[^\n]+/g) ?? [];
        const kept = lines.filter((line) => line.replace(/\n$/, "") !== rule.id);
        return kept.length === lines.length ? null : kept.join("");
      };
      const edited = await withoutRule();
      if (edited === null) return;
      // Codex drops every rule in its rules folder when one file fails to parse, so the edited text
      // is checked in a copy before the real file changes.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/868
      await checkRules(codex, edited, file);
      // Codex can save a grant while the check runs, so the rule is dropped from a fresh read.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/868
      const latest = await withoutRule();
      if (latest !== null) await fs().writeFile(file, latest);
    });
  },
};
