import { Unzip, UnzipInflate } from "fflate";
import { requestUrl } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { CODEX_ACP_PINNED_VERSION, CODEX_PACKAGING_REVISION } from "./cliSetup";

export const CODEX_BUNDLE_VERSION = `${CODEX_ACP_PINNED_VERSION}-r${CODEX_PACKAGING_REVISION}`;
const RELEASE = `https://github.com/Brevilabs/codex-acp-binary/releases/download/v${CODEX_BUNDLE_VERSION}`;

/** Downloads and verifies the pinned full bundle into an unselected staging directory.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/379
 * @param stage - Empty directory owned by the managed installation transaction.
 * @param signal - Cancellation for download and extraction; never changes the active selection.
 */
export async function installCodexArchive(stage: string, signal: AbortSignal): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  const https = requireNodeModule<typeof import("node:https")>("https");
  const target = `${process.platform}-${process.arch}`;
  // Only release targets have a tested full runtime. Never fall back to npm or a different CPU.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(target))
    throw new Error(`Codex does not support ${target}.`);
  const stem = `codex-acp-v${CODEX_BUNDLE_VERSION}-${target}`;
  const manifest = (await requestUrl(`${RELEASE}/${stem}.json`)).json as {
    archive: string;
    target: string;
    acpVersion: string;
    packagingRevision: number;
    sha256: string;
    archiveBytes: number;
    extractedBytes: number;
  };
  if (
    manifest?.archive !== `${stem}.zip` ||
    manifest.target !== target ||
    manifest.acpVersion !== CODEX_ACP_PINNED_VERSION ||
    manifest.packagingRevision !== CODEX_PACKAGING_REVISION ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.archiveBytes) ||
    manifest.archiveBytes <= 0 ||
    !Number.isSafeInteger(manifest.extractedBytes) ||
    manifest.extractedBytes <= 0
  )
    throw new Error("Invalid Codex release manifest.");
  const disk = await (
    fs.promises as typeof fs.promises & {
      statfs(path: string): Promise<{ bavail: number; bsize: number }>;
    }
  ).statfs(stage);
  // Available space already excludes the retained installation; the archive and stage coexist.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (disk.bavail * disk.bsize < manifest.archiveBytes + manifest.extractedBytes)
    throw new Error(
      "Not enough disk space to download and unpack Codex while keeping your current installation."
    );
  if (signal.aborted) throw new ManagedInstallAbortError();
  const archive = path.join(stage, "download.zip");
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const get = (url: string, hops: number): void => {
      const req = https.get(url, { signal }, (res) => {
        if (res.statusCode === 302 && res.headers.location && hops > 0) {
          res.resume();
          const next = new URL(res.headers.location, url);
          if (next.protocol !== "https:") {
            reject(new Error("Unsafe Codex download redirect."));
            return;
          }
          get(next.href, hops - 1);
        } else if (res.statusCode === 200) resolve(res);
        else {
          res.resume();
          reject(new Error(`Codex download failed: HTTP ${res.statusCode}`));
        }
      });
      req.setTimeout(30_000, () =>
        req.destroy(new Error("Codex download stalled. Retry the installation."))
      );
      req.on("error", reject);
    };
    get(`${RELEASE}/${stem}.zip`, 5);
  });
  const hash = crypto.createHash("sha256");
  let received = 0;
  const output = await fs.promises.open(archive, "wx");
  try {
    for await (const chunk of response as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > manifest.archiveBytes) {
        response.destroy();
        throw new Error("Codex archive size mismatch.");
      }
      hash.update(chunk);
      await output.writeFile(chunk);
    }
  } finally {
    response.destroy();
    await output.close();
  }
  if (received !== manifest.archiveBytes || hash.digest("hex") !== manifest.sha256)
    throw new Error("Codex archive checksum mismatch.");
  let extracted = 0;
  const entries = new Set<string>();
  const openFiles = new Set<number>();
  // Reject traversal and duplicate files before writing; links are extracted only as ordinary files.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  const unzip = new Unzip((file) => {
    const parts = file.name.split("/");
    if (
      parts.shift() !== stem ||
      parts.some((part) => part === ".." || part.includes("\\") || part.includes(":")) ||
      parts[0] === ""
    )
      throw new Error("Unsafe Codex archive path.");
    if (file.name.endsWith("/")) return;
    const relative = parts.join("/");
    if (!relative || entries.has(relative)) throw new Error("Duplicate Codex archive entry.");
    entries.add(relative);
    const dest = path.join(stage, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const fd = fs.openSync(dest, "wx", 0o755);
    openFiles.add(fd);
    file.ondata = (error, data, final) => {
      if (error) throw error;
      extracted += data.length;
      if (extracted > manifest.extractedBytes) throw new Error("Codex extracted size mismatch.");
      fs.writeSync(fd, data);
      if (final) {
        fs.closeSync(fd);
        openFiles.delete(fd);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of fs.createReadStream(archive) as AsyncIterable<Uint8Array>) {
      if (signal.aborted) throw new ManagedInstallAbortError();
      unzip.push(new Uint8Array(chunk));
    }
    unzip.push(new Uint8Array(), true);
    if (openFiles.size || extracted !== manifest.extractedBytes)
      throw new Error(
        `Incomplete Codex archive: ${openFiles.size} open, ${extracted}/${manifest.extractedBytes}.`
      );
  } finally {
    openFiles.forEach((fd) => fs.closeSync(fd));
  }
  await fs.promises.unlink(archive);
}
