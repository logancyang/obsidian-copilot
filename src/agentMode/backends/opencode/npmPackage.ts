import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { requestUrl } from "obsidian";

interface NpmMetadata {
  dist?: { tarball?: string; integrity?: string };
}

export interface NpmAsset {
  name: string;
  url: string;
  integrity: string;
}

/**
 * Resolve the first published platform package in the host's fallback order.
 * @param version - OpenCode release to install.
 * @param candidates - Platform variants ordered from most suitable to fallback.
 * @param signal - Cancellation owned by the managed install operation.
 */
export async function resolveNpmAsset(
  version: string,
  candidates: string[],
  signal?: AbortSignal
): Promise<NpmAsset> {
  for (const candidate of candidates) {
    if (signal?.aborted) throw new ManagedInstallAbortError();
    const packageName = `@opencode/cli-${candidate.slice("opencode-".length)}`;
    const url = `https://registry.npmjs.org/${packageName.replace("/", "%2F")}/${encodeURIComponent(version)}`;
    const response = await requestUrl({ url, method: "GET", throw: false });
    // Hosts try a baseline or musl build first, and not every variant is published.
    // A registry outage must still surface as an error rather than "no package".
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/560
    if (response.status === 404) continue;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenCode npm package lookup failed with status ${response.status}.`);
    }
    const { tarball, integrity } = (response.json as NpmMetadata).dist ?? {};
    if (!tarball || !integrity?.startsWith("sha512-")) {
      throw new Error(`Missing tarball or sha512 integrity for ${packageName}@${version}.`);
    }
    return { name: new URL(tarball).pathname.split("/").pop() as string, url: tarball, integrity };
  }
  throw new Error(`No matching OpenCode npm package found. Tried: ${candidates.join(", ")}.`);
}

/**
 * Check npm's sha512 claim before any archive content reaches the install stage.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/560
 * @param archivePath - Fully downloaded package tarball.
 * @param integrity - Registry integrity value for that exact package version.
 * @param signal - Cancellation owned by the managed install operation.
 */
export async function verifyNpmIntegrity(
  archivePath: string,
  integrity: string,
  signal?: AbortSignal
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  const hash = crypto.createHash("sha512");
  for await (const chunk of fs.createReadStream(archivePath)) {
    if (signal?.aborted) throw new ManagedInstallAbortError();
    hash.update(chunk as Uint8Array);
  }
  if (signal?.aborted) throw new ManagedInstallAbortError();
  if (`sha512-${hash.digest("base64")}` !== integrity) {
    throw new Error("OpenCode npm download integrity mismatch. Retry the installation.");
  }
}

/**
 * Extract only npm's expected executable; other tar entries never become files.
 * This keeps installation independent of a system archive command. The archive
 * has already passed {@link verifyNpmIntegrity}, so its headers are trusted.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/560
 * @param archivePath - Verified npm tarball.
 * @param destPath - Staged executable path inside the managed install root.
 * @param binaryName - Executable name for the resolved operating system.
 * @param signal - Cancellation owned by the managed install operation.
 */
export async function extractNpmBinary(
  archivePath: string,
  destPath: string,
  binaryName: string,
  signal?: AbortSignal
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const zlib = requireNodeModule<typeof import("node:zlib")>("zlib");
  const { Transform, promises } = requireNodeModule<typeof import("node:stream")>("stream");
  if (signal?.aborted) throw new ManagedInstallAbortError();
  const wanted = `package/bin/${binaryName}`;
  const header = Buffer.alloc(512);
  let headerBytes = 0;
  let skip = 0;
  let emit = 0;
  let found = false;

  const picker = new Transform({
    transform(chunk: Uint8Array, _encoding, callback) {
      let data = chunk;
      while (data.length > 0) {
        if (emit > 0) {
          const count = Math.min(emit, data.length);
          this.push(data.subarray(0, count));
          emit -= count;
          data = data.subarray(count);
        } else if (found) {
          break;
        } else if (skip > 0) {
          const count = Math.min(skip, data.length);
          skip -= count;
          data = data.subarray(count);
        } else {
          const count = Math.min(512 - headerBytes, data.length);
          header.set(data.subarray(0, count), headerBytes);
          headerBytes += count;
          data = data.subarray(count);
          if (headerBytes < 512) break;
          headerBytes = 0;
          const name = header.toString("utf8", 0, 100).split("\0", 1)[0];
          const size = Number.parseInt(header.toString("ascii", 124, 136), 8) || 0;
          if (name === wanted) {
            found = true;
            emit = size;
          } else {
            skip = Math.ceil(size / 512) * 512;
          }
        }
      }
      callback();
    },
  });

  try {
    await promises.pipeline(
      fs.createReadStream(archivePath),
      zlib.createGunzip(),
      picker,
      fs.createWriteStream(destPath),
      { signal }
    );
  } catch (error) {
    if (signal?.aborted) throw new ManagedInstallAbortError();
    throw error;
  }
  if (!found) throw new Error(`OpenCode npm archive lacks ${wanted}.`);
}
