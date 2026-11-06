import type { ApprovedRule, ApprovedRuleStore } from "@/agentMode/session/types";
import { sanitizeBuiltinSkillEnvOverrides } from "@/agentMode/backends/shared/builtinSkillEnv";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { codexCliInvocation } from "./codexAuth";
import { defaultCodexHome } from "./codexPlanUsage";

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

let previousCall: Promise<unknown> = Promise.resolve();

// A removal rewrites the file from what it read, so two quick removals must not both read the
// same text, and a re-list must not read before a pending removal lands.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/868
function oneAtATime<T>(call: () => Promise<T>): Promise<T> {
  const result = previousCall.then(call);
  previousCall = result.catch(() => undefined);
  return result;
}

function fs(): typeof import("node:fs").promises {
  return requireNodeModule<typeof import("node:fs")>("fs").promises;
}

function rulesFile(): string {
  const overrides = sanitizeBuiltinSkillEnvOverrides(
    getSettings().agentMode?.backends?.codex?.envOverrides
  );
  const codexHome = overrides.CODEX_HOME || process.env.CODEX_HOME || defaultCodexHome();
  return requireNodeModule<typeof import("node:path")>("path").join(
    codexHome,
    "rules",
    "default.rules"
  );
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

type CodexCli = Awaited<ReturnType<typeof codexCliInvocation>>;

function checkRules(codex: CodexCli, file: string): Promise<void> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  return new Promise((resolve, reject) => {
    execFile(
      codex.command,
      [...codex.args, "execpolicy", "check", "--rules", file, ANY_COMMAND],
      { env: codex.env, timeout: CHECK_TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) =>
        error
          ? reject(
              new Error(
                `Codex couldn't read the rules file without it, so the file was left as it was. ${String(stderr).trim() || error.message}`
              )
            )
          : resolve()
    );
  });
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
      const before = await fs().readFile(file, "utf8");
      const lines = before.match(/[^\n]*\n|[^\n]+/g) ?? [];
      const kept = lines.filter((line) => line.replace(/\n$/, "") !== rule.id);
      // A file edited since the page listed it is rewritten only to drop the rule.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/868
      if (kept.length === lines.length) return;
      await fs().writeFile(file, kept.join(""));
      try {
        await checkRules(codex, file);
      } catch (error) {
        // Codex drops every rule in its rules folder when one file fails to parse, so a failed check
        // puts every byte back.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/868
        await fs().writeFile(file, before);
        throw error;
      }
    });
  },
};
