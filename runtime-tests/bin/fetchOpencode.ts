/**
 * Download and cache the exact opencode release the plugin pins, then verify
 * it. Any failure exits non-zero: the suite must never fall back to another
 * local opencode or to a fake process.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import {
  parseVersionFromStdout,
  pickMatchingAsset,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { resolveOpencodeTarget } from "@/agentMode/backends/opencode/platformResolver";
import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";

import { pinnedBinaryPath } from "../harness/pinnedBinary";

async function main(): Promise<void> {
  const target = pinnedBinaryPath();
  if (fs.existsSync(target) && installedVersion(target) === OPENCODE_PINNED_VERSION) {
    process.stdout.write(`opencode ${OPENCODE_PINNED_VERSION} already cached at ${target}\n`);
    return;
  }

  const { candidates } = await resolveOpencodeTarget();
  const release = (await fetchJson(
    `https://api.github.com/repos/sst/opencode/releases/tags/v${OPENCODE_PINNED_VERSION}`
  )) as Parameters<typeof pickMatchingAsset>[0];
  const asset = pickMatchingAsset(release, candidates);

  process.stdout.write(`downloading ${asset.name} …\n`);
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-dl-"));
  const archive = path.join(staging, asset.name);
  const response = await fetch(asset.browser_download_url);
  if (!response.ok)
    throw new Error(`download failed: ${response.status} ${asset.browser_download_url}`);
  await fs.promises.writeFile(archive, new Uint8Array(await response.arrayBuffer()));

  const extracted = path.join(staging, "out");
  await fs.promises.mkdir(extracted, { recursive: true });
  if (asset.name.endsWith(".zip")) {
    execFileSync("unzip", ["-oq", archive, "-d", extracted]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  }

  const binary = find(extracted, process.platform === "win32" ? "opencode.exe" : "opencode");
  if (!binary) throw new Error(`no opencode executable inside ${asset.name}`);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(binary, target);
  await fs.promises.chmod(target, 0o755);
  await fs.promises.rm(staging, { recursive: true, force: true });

  const installed = installedVersion(target);
  if (installed !== OPENCODE_PINNED_VERSION) {
    throw new Error(
      `expected opencode ${OPENCODE_PINNED_VERSION}, downloaded reports ${installed}`
    );
  }
  process.stdout.write(`opencode ${installed} ready at ${target}\n`);
}

function installedVersion(binary: string): string | undefined {
  try {
    return parseVersionFromStdout(execFileSync(binary, ["--version"], { encoding: "utf-8" }));
  } catch {
    return undefined;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} (unauthenticated GitHub API allows 60/hr)`);
  }
  return response.json();
}

function find(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = find(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
