import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { requireNodeModule } from "@/utils/desktopRuntime";

interface NpmMetadata {
  name?: string;
  version?: string;
  dist?: { tarball?: string; integrity?: string };
}

interface MetadataResponse {
  status: number;
  json: unknown;
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
 * @param fetchMetadata - Registry request that also works in Obsidian's desktop runtime.
 */
export async function resolveNpmAsset(
  version: string,
  candidates: string[],
  fetchMetadata: (url: string) => Promise<MetadataResponse>
): Promise<NpmAsset> {
  for (const candidate of candidates) {
    const packageName = `@opencode/cli-${candidate.slice("opencode-".length)}`;
    const url = `https://registry.npmjs.org/${packageName.replace("/", "%2F")}/${encodeURIComponent(version)}`;
    const response = await fetchMetadata(url);
    if (response.status === 404) continue;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenCode npm package lookup failed with status ${response.status}.`);
    }
    const metadata = response.json as NpmMetadata;
    const tarball = metadata.dist?.tarball;
    const integrity = metadata.dist?.integrity;
    if (metadata.name !== packageName || metadata.version !== version || !tarball) {
      throw new Error(`Invalid npm metadata for ${packageName}@${version}.`);
    }
    const tarballUrl = new URL(tarball);
    if (tarballUrl.protocol !== "https:" || !tarballUrl.pathname.endsWith(".tgz")) {
      throw new Error(`Invalid npm tarball URL for ${packageName}@${version}.`);
    }
    if (!integrity || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
      throw new Error(`Missing or invalid sha512 integrity for ${packageName}@${version}.`);
    }
    return { name: tarballUrl.pathname.split("/").pop() as string, url: tarball, integrity };
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
  const expected = Buffer.from(integrity.slice("sha512-".length), "base64");
  const hash = crypto.createHash("sha512");
  for await (const rawChunk of fs.createReadStream(archivePath)) {
    if (signal?.aborted) throw new ManagedInstallAbortError();
    hash.update(rawChunk as Uint8Array);
  }
  if (signal?.aborted) throw new ManagedInstallAbortError();
  const actual = hash.digest();
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(new Uint8Array(expected), new Uint8Array(actual))
  ) {
    throw new Error("OpenCode npm download integrity mismatch. Retry the installation.");
  }
}

/**
 * Extract only npm's expected executable; other tar entries never become files.
 * This keeps installation independent of a system archive command.
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
  const wanted = `package/bin/${binaryName}`;
  const header = Buffer.alloc(512);
  let headerBytes = 0;
  let remaining = 0;
  let entrySize = 0;
  let padding = 0;
  let extracting = false;
  let output: import("node:fs/promises").FileHandle | undefined;

  try {
    const stream = fs.createReadStream(archivePath).pipe(zlib.createGunzip());
    outer: for await (const rawChunk of stream) {
      if (signal?.aborted) throw new ManagedInstallAbortError();
      const chunk = rawChunk as Uint8Array;
      let offset = 0;
      while (offset < chunk.length) {
        if (padding > 0) {
          const count = Math.min(padding, chunk.length - offset);
          padding -= count;
          offset += count;
          continue;
        }
        if (remaining > 0) {
          const count = Math.min(remaining, chunk.length - offset);
          if (extracting && output) {
            let written = 0;
            while (written < count) {
              if (signal?.aborted) throw new ManagedInstallAbortError();
              const result = await output.write(chunk, offset + written, count - written);
              if (result.bytesWritten === 0) throw new Error("Could not write OpenCode binary.");
              written += result.bytesWritten;
            }
          }
          remaining -= count;
          offset += count;
          if (remaining === 0) {
            if (extracting) break outer;
            padding = (512 - (entrySize % 512)) % 512;
          }
          continue;
        }
        const count = Math.min(512 - headerBytes, chunk.length - offset);
        header.set(chunk.subarray(offset, offset + count), headerBytes);
        headerBytes += count;
        offset += count;
        if (headerBytes < 512) continue;
        headerBytes = 0;
        const name = header.toString("utf8", 0, 100).split("\0", 1)[0];
        if (!name) break outer;
        const sizeText = header.toString("ascii", 124, 136).replace(/\0.*$/, "").trim();
        const size = Number.parseInt(sizeText, 8);
        if (!Number.isSafeInteger(size) || size < 0)
          throw new Error("Invalid OpenCode npm archive.");
        remaining = size;
        entrySize = size;
        extracting = name === wanted && (header[156] === 0 || header[156] === 48);
        if (extracting) {
          output = await fs.promises.open(destPath, "w");
          if (remaining === 0) break outer;
        } else if (remaining === 0) {
          padding = 0;
        }
      }
    }
    if (!output || remaining > 0) throw new Error(`OpenCode npm archive lacks ${wanted}.`);
  } finally {
    await output?.close();
  }
}
