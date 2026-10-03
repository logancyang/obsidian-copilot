import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { redactLogText } from "@/utils/redactLog";

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
    const entry: ScenarioResult = { ...result, error: result.error && redactLogText(result.error) };
    if (diagnostics !== undefined) {
      entry.log = `logs/${this.#results.length + 1}-${slug(result.name)}.log`;
      fs.writeFileSync(path.join(this.#dir, entry.log), redactLogText(diagnostics));
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
      // CI names the pushed commit; its checkout of a pull request is a temporary merge commit.
      commit: process.env.COMMIT_SHA ?? commandOutput("git", ["rev-parse", "HEAD"]),
      elapsedMs: Date.now() - this.#startedAt,
      scenarios: this.#results,
    };
    const file = path.join(this.#dir, "summary.json");
    fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
    return file;
  }
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
