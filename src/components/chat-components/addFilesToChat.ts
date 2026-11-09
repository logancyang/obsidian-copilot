import { ALLOWED_NOTE_CONTEXT_EXTENSIONS } from "@/constants";
import { logError } from "@/logger";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { App, Notice, TFile } from "obsidian";

export interface AddFilesToChatOptions {
  onAddImage: (files: File[]) => void;
  setContextNotes: (update: (prev: TFile[]) => TFile[]) => void;
  acceptAnyFileType?: boolean;
}

export const CONTEXT_FILE_ACCEPT = [
  "image/*",
  ...ALLOWED_NOTE_CONTEXT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function getOsPath(file: File): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is absent on mobile, where picked files have no OS path
    const electron = require("electron") as {
      webUtils?: { getPathForFile?: (file: File) => string };
    };
    return electron.webUtils?.getPathForFile?.(file) || null;
  } catch {
    return null;
  }
}

function findVaultFile(app: App, file: File): TFile | null {
  const osPath = getOsPath(file);
  if (!osPath) return null;
  const vaultFile = app.vault.getAbstractFileByPath(toVaultRelative(osPath, getVaultBase(app)));
  return vaultFile instanceof TFile ? vaultFile : null;
}

async function copyIntoVault(app: App, file: File): Promise<TFile> {
  const path = await app.fileManager.getAvailablePathForAttachment(
    file.name,
    app.workspace.getActiveFile()?.path
  );
  return app.vault.createBinary(path, await file.arrayBuffer());
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function resolveContextFile(
  app: App,
  file: File,
  acceptAnyFileType: boolean
): Promise<TFile | null> {
  const vaultFile = findVaultFile(app, file);
  const extension = vaultFile?.extension ?? getExtension(file.name);
  // Agent Chat sends only the path and the agent opens the file with its own tools, so any type works.
  // https://github.com/logancyang/obsidian-copilot/issues/4043
  if (!acceptAnyFileType && !ALLOWED_NOTE_CONTEXT_EXTENSIONS.includes(extension)) {
    new Notice(
      `Can't attach ${file.name}: chat accepts images and ${ALLOWED_NOTE_CONTEXT_EXTENSIONS.join(", ")} files.`
    );
    return null;
  }
  return vaultFile ?? copyIntoVault(app, file);
}

// A file from outside the vault reaches the agent only as a vault path, so it is copied to the attachment folder first.
// https://github.com/logancyang/obsidian-copilot/issues/4043
export async function addFilesToChat(
  app: App,
  files: File[],
  options: AddFilesToChatOptions
): Promise<void> {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length > 0) options.onAddImage(images);

  for (const file of files) {
    if (images.includes(file)) continue;
    try {
      const contextFile = await resolveContextFile(app, file, options.acceptAnyFileType ?? false);
      if (!contextFile) continue;
      options.setContextNotes((prev) =>
        prev.some((note) => note.path === contextFile.path) ? prev : [...prev, contextFile]
      );
    } catch (error) {
      logError(`[Chat] could not add ${file.name} to the vault`, error);
      new Notice(`Could not add ${file.name} to the vault.`);
    }
  }
}
