import { downloadFile } from "@/agentMode/backends/shared/downloadFile";
import { extractArchive } from "@/agentMode/backends/shared/extractArchive";
import type { InstallProgressReporter } from "@/agentMode/backends/shared/installProgress";
import { requestUrl } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { CODEX_PINNED_VERSION } from "./cliSetup";

export { CODEX_PINNED_VERSION } from "./cliSetup";
const RELEASE = `https://github.com/Brevilabs/codex-acp-binary/releases/download/v${CODEX_PINNED_VERSION}`;

export async function installCodexArchive(
  stage: string,
  signal: AbortSignal,
  progress?: Pick<InstallProgressReporter, "download" | "extracting">
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const target = `${process.platform}-${process.arch}`;
  // Only release targets have a tested full runtime. Never fall back to npm or a different CPU.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(target))
    throw new Error(`Codex does not support ${target}.`);
  // A cancelled setup must not wait on the manifest request, which cannot be aborted.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (signal.aborted) throw new ManagedInstallAbortError();
  const stem = `codex-acp-v${CODEX_PINNED_VERSION}-${target}`;
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
  const archive = path.join(stage, archiveName);
  await downloadFile(`${RELEASE}/${archiveName}`, archive, {
    displayName: "Codex",
    bytes: manifest.archiveBytes,
    sha256: manifest.sha256,
    signal,
    onProgress: (received, total) => progress?.download(received, total),
  });
  progress?.extracting();
  await extractArchive(archive, stage, { signal, stripComponents: 1 });
  await fs.promises.unlink(archive);
}
