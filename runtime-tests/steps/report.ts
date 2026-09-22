import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { BINARY_CACHE_HOME, pinnedBinaryPath } from "../harness/pinnedBinary";

/** One scenario's outcome as written to `summary.json`. */
export interface ScenarioResult {
  name: string;
  status: string;
  elapsedMs: number;
  error?: string;
  /** Redacted diagnostics file, relative to the report directory. */
  log?: string;
}

/**
 * Collects per-scenario outcomes into `runtime-tests/.report/`, the directory
 * CI uploads when the job fails: `summary.json` identifies the binary, OS,
 * commit, and each scenario's result and elapsed time; `logs/` holds the
 * redacted runtime logs of every scenario that failed.
 */
export class Report {
  readonly #dir: string;
  readonly #results: ScenarioResult[] = [];
  readonly #startedAt = Date.now();

  constructor(dir: string) {
    this.#dir = dir;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  }

  /** Record one scenario; `diagnostics`, when given, is redacted and saved. */
  add(result: Omit<ScenarioResult, "log">, diagnostics?: string): void {
    const entry: ScenarioResult = { ...result, error: result.error && redact(result.error) };
    if (diagnostics !== undefined) {
      entry.log = `logs/${this.#results.length + 1}-${slug(result.name)}.log`;
      fs.writeFileSync(path.join(this.#dir, entry.log), redact(diagnostics));
    }
    this.#results.push(entry);
  }

  /** How many scenarios have been recorded. */
  get size(): number {
    return this.#results.length;
  }

  /** Write `summary.json` and return its path. */
  write(): string {
    const summary = {
      // Probed under the cache's home, like the fetcher, so the developer's home is untouched.
      opencodeVersion: commandOutput(pinnedBinaryPath(), ["--version"], {
        ...process.env,
        HOME: BINARY_CACHE_HOME,
      }),
      os: `${process.platform}-${process.arch} ${os.release()}`,
      node: process.version,
      commit: process.env.GITHUB_SHA ?? commandOutput("git", ["rev-parse", "HEAD"]),
      elapsedMs: Date.now() - this.#startedAt,
      scenarios: this.#results,
    };
    const file = path.join(this.#dir, "summary.json");
    fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
    return file;
  }
}

const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]"],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[abpr])[-_][\w-]{8,}/g, "[redacted]"],
  [
    /(["']?[\w-]*(?:api[_-]?key|token|secret|password|credential)["']?\s*[:=]\s*)(["']?)[^\s"',}]+\2/gi,
    "$1$2[redacted]$2",
  ],
  [/(^|[\s"'=:(])\/(?:Users|home)\/[^/\s"']+/gm, "$1~"],
];

/** Mask key- and token-shaped values and home-directory paths. */
export function redact(text: string): string {
  let out = text.split(os.homedir()).join("~");
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function commandOutput(command: string, args: string[], env = process.env): string {
  try {
    return execFileSync(command, args, { encoding: "utf-8", timeout: 10_000, env }).trim();
  } catch (error) {
    return `unavailable (${String(error)})`;
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
