import type { ApprovedRule, ApprovedRuleStore } from "@/agentMode/session/types";
import { agentChildEnv, agentUserPath } from "@/agentMode/backends/shared/agentUserDirs";
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
  return path().join(codexHomeDir(agentChildEnv(getSettings(), "codex")), "rules", "default.rules");
}

export function codexHomeDir(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME || agentUserPath(env, ".codex");
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
  try {
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
                  `Codex couldn't validate the changed rules, so the file was left as it was. ${String(stderr).trim().replaceAll(copy, file) || error.message}`
                )
              )
            : resolve()
      );
    });
  } finally {
    await fs().rm(dir, { recursive: true, force: true });
  }
}

function ruleOffsets(text: string, rule: string): number[] {
  const offsets: number[] = [];
  let position = 0;
  for (const line of text.match(/[^\n]*\n|[^\n]+/g) ?? []) {
    if (line.replace(/\n$/, "") === rule) offsets.push(position);
    position += Buffer.byteLength(line);
  }
  return offsets;
}

// One-byte comment markers keep a failed write from corrupting a rule or truncating appended grants.
// Refuse stale positions before changing any marker. https://github.com/Brevilabs/obsidian-copilot-private/issues/868
async function writeRuleMarkers(
  file: string,
  expected: string,
  offsets: number[],
  marker: number
): Promise<void> {
  const handle = await fs().open(file, "r+");
  try {
    for (const position of offsets) {
      const bytes = new Uint8Array(Buffer.byteLength(expected));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, position);
      if (bytesRead !== bytes.length || Buffer.from(bytes).toString() !== expected) {
        throw new Error("The rules file changed. Reload approved rules before changing this rule.");
      }
    }
    for (const position of offsets) {
      const { bytesWritten } = await handle.write(new Uint8Array([marker]), 0, 1, position);
      if (bytesWritten !== 1) throw new Error("Codex's rule marker could not be written.");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export const codexApprovedRules: ApprovedRuleStore = {
  async list() {
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
      return allows === null ? [] : [{ id: line, allows, appliesTo: { kind: "file", path: file } }];
    });
  },

  async remove(_plugin, rule) {
    const file = (rule.appliesTo as { path: string }).path;
    const codex = await codexCliInvocation(
      getSettings(),
      "Install Codex before removing its approved rules."
    );
    const before = await fs().readFile(file, "utf8");
    const positions = ruleOffsets(before, rule.id);
    if (positions.length === 0) return;
    const disabled = `#${rule.id.slice(1)}`;
    const candidate = Buffer.from(before);
    for (const position of positions) candidate[position] = 35;
    await checkRules(codex, candidate.toString(), file);
    const latest = await fs().readFile(file, "utf8");
    const offsets = ruleOffsets(latest, rule.id);
    if (offsets.length === 0) return;
    await writeRuleMarkers(file, rule.id, offsets, 35);
    return {
      async undo() {
        const current = await fs().readFile(file, "utf8");
        if (ruleOffsets(current, rule.id).length > 0) return;
        const restored = Buffer.from(current);
        for (const position of offsets) {
          if (
            restored.subarray(position, position + Buffer.byteLength(disabled)).toString() !==
            disabled
          ) {
            throw new Error("The removed rule changed. Reload approved rules before restoring it.");
          }
          restored[position] = rule.id.charCodeAt(0);
        }
        await checkRules(codex, restored.toString(), file);
        await writeRuleMarkers(file, disabled, offsets, rule.id.charCodeAt(0));
      },
    };
  },
};
