/**
 * Install the exact opencode release the plugin pins, using the plugin's own
 * installer (platform resolution, GitHub release lookup, download, extraction,
 * version verification), into a cache the suite owns. A cached binary is
 * reused only while it reports the pinned version. Any failure exits non-zero:
 * the suite never falls back to another opencode or to a fake process.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { App as ObsidianApp } from "obsidian";

import {
  OpencodeBinaryManager,
  parseVersionFromStdout,
  verifyOpencodeBinary,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";
import type CopilotPlugin from "@/main";

import { App } from "../harness/obsidianApp";
import { allowRequestUrl } from "../harness/obsidianShim";
import { BINARY_CACHE_HOME, pinnedBinaryPath } from "../harness/pinnedBinary";

// The installer's download watchdog uses `window.setTimeout`.
(globalThis as { window?: unknown }).window ??= globalThis;

async function main(): Promise<void> {
  // Only the GitHub API request sees the token; no process this one starts inherits it.
  const githubToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  // The installer places releases under `<home>/.obsidian-copilot`, and even
  // `opencode --version` creates its state directories under the home.
  process.env.HOME = BINARY_CACHE_HOME;
  const target = pinnedBinaryPath();
  const cached = await reportedVersion(target);
  if (cached === OPENCODE_PINNED_VERSION) {
    process.stdout.write(`opencode ${cached} cached at ${target}\n`);
    return;
  }
  if (cached !== null) process.stdout.write(`discarding cached binary reporting ${cached}\n`);
  // Drop a partial or mismatched install so the installer cannot treat it as done.
  await fs.promises.rm(path.dirname(path.dirname(target)), { recursive: true, force: true });

  allowRequestUrl(async ({ url, method, headers }) => {
    const token = url.startsWith("https://api.github.com/") ? githubToken : undefined;
    const response = await fetch(url, {
      method,
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  });
  const plugin = { app: new App(BINARY_CACHE_HOME) as unknown as ObsidianApp };
  const installed = await new OpencodeBinaryManager(plugin as CopilotPlugin).install({
    onProgress: (event) => {
      if (event.phase !== "download") process.stdout.write(`${event.phase}\n`);
    },
  });

  const version = await reportedVersion(target);
  if (installed.path !== target || version !== OPENCODE_PINNED_VERSION) {
    throw new Error(
      `expected opencode ${OPENCODE_PINNED_VERSION} at ${target}; ` +
        `the installer produced ${installed.path}, which reports ${version ?? "nothing"}`
    );
  }
  process.stdout.write(`opencode ${version} installed at ${target}\n`);
}

/** The version `binary --version` reports, or null when it is missing or does not run. */
async function reportedVersion(binary: string): Promise<string | null> {
  try {
    return parseVersionFromStdout((await verifyOpencodeBinary(binary)).stdout) ?? null;
  } catch {
    return null;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`fetching opencode ${OPENCODE_PINNED_VERSION} failed: ${String(error)}\n`);
  process.exit(1);
});
