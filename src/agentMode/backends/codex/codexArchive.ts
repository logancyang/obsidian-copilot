import { extractArchive } from "@/agentMode/backends/shared/extractArchive";
import { requestUrl } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { CODEX_PINNED_VERSION } from "./cliSetup";

export { CODEX_PINNED_VERSION } from "./cliSetup";
const RELEASE = `https://github.com/Brevilabs/codex-acp-binary/releases/download/v${CODEX_PINNED_VERSION}`;

export type CodexArchiveProgress =
  | { phase: "download"; received: number; total: number }
  | { phase: "extract" };

/**
 * Downloads, verifies, and extracts the Codex adapter and bundled runtime for
 * this platform. Leaves the active installation unchanged so the caller can
 * validate the extracted files before selecting them.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/379
 * @param stage - Empty temporary directory in which to extract the bundle.
 * @param signal - Cancels download and extraction.
 * @param onProgress - Reports verified-size download bytes and archive extraction.
 */
export async function installCodexArchive(
  stage: string,
  signal: AbortSignal,
  onProgress?: (progress: CodexArchiveProgress) => void
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  const https = requireNodeModule<typeof import("node:https")>("https");
  const target = `${process.platform}-${process.arch}`;
  // Only release targets have a tested full runtime. Never fall back to npm or a different CPU.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(target))
    throw new Error(`Codex does not support ${target}.`);
  // A cancelled setup must not wait on the manifest request, which cannot be aborted.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (signal.aborted) throw new ManagedInstallAbortError();
  const stem = `codex-acp-v${CODEX_PINNED_VERSION}-${target}`;
  // Linux releases use tar.gz so extraction works with GNU tar.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  const archiveName = `${stem}${process.platform === "linux" ? ".tar.gz" : ".zip"}`;
  const manifest = (await requestUrl(`${RELEASE}/${stem}.json`)).json as {
    archive: string;
    target: string;
    acpVersion: string;
    sha256: string;
    archiveBytes: number;
    extractedBytes: number;
  };
  if (
    manifest?.archive !== archiveName ||
    manifest.target !== target ||
    manifest.acpVersion !== CODEX_PINNED_VERSION ||
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
  const archive = path.join(stage, archiveName);
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
    get(`${RELEASE}/${archiveName}`, 5);
  });
  const hash = crypto.createHash("sha256");
  let received = 0;
  let reportedPercent = 0;
  onProgress?.({ phase: "download", received, total: manifest.archiveBytes });
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
      // Large release archives need visible byte progress without rerendering for every network chunk.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/578
      const percent = Math.floor((received / manifest.archiveBytes) * 100);
      if (percent !== reportedPercent) {
        reportedPercent = percent;
        onProgress?.({ phase: "download", received, total: manifest.archiveBytes });
      }
    }
  } finally {
    response.destroy();
    await output.close();
  }
  if (received !== manifest.archiveBytes || hash.digest("hex") !== manifest.sha256)
    throw new Error("Codex archive checksum mismatch.");
  onProgress?.({ phase: "extract" });
  await extractArchive(archive, stage, { signal, stripComponents: 1 });
  await fs.promises.unlink(archive);
}
