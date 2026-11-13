import { ALLOWED_NOTE_CONTEXT_EXTENSIONS } from "@/constants";
import { logError } from "@/logger";
import { copyIntoProjectSources } from "@/projects/projectLinks";
import type { VaultSplit } from "@/utils/splitByVault";
import { App, Notice, TFile, TFolder } from "obsidian";

export interface AttachToChatOptions {
  contextNotes: readonly TFile[];
  selectedImages: readonly File[];
  onAddImage: (files: File[]) => void;
  setContextNotes: (update: (prev: TFile[]) => TFile[]) => void;
  acceptAnyFileType?: boolean;
  projectFolderPath?: string;
  onAddFolders?: (folderPaths: string[]) => void;
}

export const CONTEXT_FILE_ACCEPT = [
  "image/*",
  ...ALLOWED_NOTE_CONTEXT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

const CHAT_IMAGE_EXTENSIONS = ["png", "gif", "jpeg", "jpg", "webp"];

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function readVaultImage(app: App, file: TFile): Promise<File> {
  const type = file.extension === "jpg" ? "image/jpeg" : `image/${file.extension}`;
  return new File([await app.vault.readBinary(file)], file.name, { type });
}

async function copyIntoVault(app: App, file: File, projectFolderPath?: string): Promise<TFile> {
  // Inside a project, a file from the computer is kept with the project's sources instead of the attachment folder.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/898
  if (projectFolderPath) {
    const [copy] = await copyIntoProjectSources(app, projectFolderPath, [file]);
    return copy;
  }
  const path = await app.fileManager.getAvailablePathForAttachment(
    file.name,
    app.workspace.getActiveFile()?.path
  );
  return app.vault.createBinary(path, await file.arrayBuffer());
}

function announceCopies(copies: readonly TFile[]): void {
  const namesByFolder = new Map<string, string[]>();
  for (const copy of copies) {
    const folder = copy.path.slice(0, copy.path.length - copy.name.length);
    namesByFolder.set(folder, [...(namesByFolder.get(folder) ?? []), copy.name]);
  }
  for (const [folder, names] of namesByFolder) {
    new Notice(`Copied ${names.join(", ")} into ${folder || "the root of your vault"}`);
  }
}

async function attachFile(
  app: App,
  file: TFile | File,
  options: AttachToChatOptions,
  copies: TFile[]
) {
  const extension = file instanceof TFile ? file.extension : getExtension(file.name);
  if (CHAT_IMAGE_EXTENSIONS.includes(extension)) {
    if (options.selectedImages.some((image) => image.name === file.name)) {
      new Notice("This image is already in the context");
      return;
    }
    options.onAddImage([file instanceof TFile ? await readVaultImage(app, file) : file]);
    return;
  }
  // Agent Chat sends only the path and the agent opens the file with its own tools, so any type works.
  // https://github.com/logancyang/obsidian-copilot/issues/4043
  if (!options.acceptAnyFileType && !ALLOWED_NOTE_CONTEXT_EXTENSIONS.includes(extension)) {
    new Notice(
      `Can't attach ${file.name}: chat accepts images and ${ALLOWED_NOTE_CONTEXT_EXTENSIONS.join(", ")} files.`
    );
    return;
  }
  // A file from outside the vault reaches the agent only as a vault path, so it is copied into the vault first.
  // https://github.com/logancyang/obsidian-copilot/issues/4043
  const note =
    file instanceof TFile ? file : await copyIntoVault(app, file, options.projectFolderPath);
  if (note !== file) copies.push(note);
  if (options.contextNotes.some((existing) => existing.path === note.path)) {
    new Notice("This note is already in the context");
    return;
  }
  options.setContextNotes((prev) =>
    prev.some((existing) => existing.path === note.path) ? prev : [...prev, note]
  );
}

export async function attachToChat(
  app: App,
  incoming: VaultSplit,
  options: AttachToChatOptions
): Promise<void> {
  const folderPaths = incoming.vaultItems
    .filter((item) => item instanceof TFolder)
    .map((folder) => folder.path);
  if (folderPaths.length > 0) options.onAddFolders?.(folderPaths);
  if (incoming.outsideFolderNames.length > 0) {
    // A message mentions a folder by its vault path, which a folder from the computer does not have.
    // https://github.com/logancyang/obsidian-copilot/issues/3858
    new Notice(
      `Folders from outside the vault can't be added to a message: ${incoming.outsideFolderNames.join(", ")}`
    );
  }
  const files = [
    ...incoming.vaultItems.filter((item): item is TFile => item instanceof TFile),
    ...incoming.outsideFiles,
  ];
  const copies: TFile[] = [];
  for (const file of files) {
    try {
      await attachFile(app, file, options, copies);
    } catch (error) {
      logError(`[Chat] could not add ${file.name} to the vault`, error);
      new Notice(`Could not add ${file.name} to the vault.`);
    }
  }
  // Every file Copilot saves into the vault is announced with its name and folder, once per drop or pick, so nothing lands there unseen.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/898
  announceCopies(copies);
}
