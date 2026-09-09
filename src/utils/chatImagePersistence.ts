import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { sha256 } from "@/utils/hash";
import { isFileAlreadyExistsError } from "@/utils/vaultAdapterUtils";
import { normalizePath, type App, type Vault } from "obsidian";

const IMAGE_EXTENSIONS = new Map([
  ["jpeg", "jpg"],
  ["svg+xml", "svg"],
  ["x-icon", "ico"],
  ["vnd.microsoft.icon", "ico"],
  ["x-ms-bmp", "bmp"],
]);

interface MessageWithImages {
  message: string;
  content?: unknown[];
}

interface AttachmentVault extends Vault {
  getConfig(key: "attachmentFolderPath"): string;
}

/**
 * Persist uploaded images before a transcript is written, returning message
 * copies with vault embeds while leaving the live conversation untouched.
 * A failed attachment write rejects the save rather than dropping the image.
 *
 * @param app - The vault in which the conversation is being saved.
 * @param messages - Display messages, including their uploaded image data URLs.
 * @param notePath - Destination transcript path, even when the note does not exist yet.
 */
export async function prepareChatImagesForSave<T extends MessageWithImages>(
  app: App,
  messages: T[],
  notePath: string
): Promise<T[]> {
  const prepared: T[] = [];
  const parentPath = notePath.slice(0, Math.max(0, notePath.lastIndexOf("/")));

  for (const message of messages) {
    const embeds: string[] = [];
    for (const item of message.content ?? []) {
      // Only uploaded images belong in the attachment store; remote URLs and
      // other rich content are not downloads: https://github.com/logancyang/obsidian-copilot/issues/2900
      if (!item || typeof item !== "object" || !("type" in item) || item.type !== "image_url") {
        continue;
      }
      const image = "image_url" in item ? item.image_url : undefined;
      if (
        !image ||
        typeof image !== "object" ||
        !("url" in image) ||
        typeof image.url !== "string"
      ) {
        continue;
      }
      if (!image.url.startsWith("data:image/")) continue;

      // A corrupt uploaded image must fail the save, not silently disappear:
      // https://github.com/logancyang/obsidian-copilot/issues/2900
      const match = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image.url);
      if (!match) throw new Error("Cannot save an invalid uploaded image.");
      const bytes = base64ToArrayBuffer(match[2]);
      const base64 = arrayBufferToBase64(bytes);
      const subtype = match[1].toLowerCase();
      // Picker MIME subtypes can contain punctuation without making the upload corrupt.
      // https://github.com/logancyang/obsidian-copilot/issues/2900
      const extension = IMAGE_EXTENSIONS.get(subtype) ?? subtype.replace(/[^a-z0-9]/g, "");
      if (
        !bytes.byteLength ||
        !extension ||
        base64.replace(/=+$/, "") !== match[2].replace(/=+$/, "") ||
        (match[2].includes("=") && match[2] !== base64)
      ) {
        throw new Error("Cannot save an invalid uploaded image.");
      }
      const name = `copilot-image-${sha256(base64)}`;

      // Obsidian's attachment allocator uses cached folders and cannot allocate
      // inside hidden chat roots. Resolve the same vault setting through the adapter.
      // https://github.com/logancyang/obsidian-copilot/issues/2900
      const setting = (app.vault as AttachmentVault).getConfig("attachmentFolderPath");
      const folder = normalizePath(
        setting === "." || setting === "./"
          ? parentPath
          : setting.startsWith("./")
            ? `${parentPath}/${setting.slice(2)}`
            : setting
      ).replace(/^\/+|\/+$/g, "");
      const hidden = folder.split("/").some((part) => part.startsWith("."));
      let current = "";
      for (const part of folder.split("/").filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        if (!(await app.vault.adapter.exists(current))) {
          try {
            if (hidden) await app.vault.adapter.mkdir(current);
            else await app.vault.createFolder(current);
          } catch (error) {
            // Concurrent saves may create the shared attachment folder first.
            // https://github.com/logancyang/obsidian-copilot/issues/2900
            if (!isFileAlreadyExistsError(error)) throw error;
          }
        }
      }
      const prefix = folder ? `${folder}/` : "";
      let path = `${prefix}${name}.${extension}`;
      let suffix = 1;
      while (await app.vault.adapter.exists(path)) {
        path = `${prefix}${name} ${suffix++}.${extension}`;
      }
      const candidates = (await app.vault.adapter.list(folder)).files.filter(
        (candidate) =>
          candidate.startsWith(`${prefix}${name}`) && candidate.endsWith(`.${extension}`)
      );
      let reused = false;
      for (const candidate of candidates) {
        // Autosave reuses matching bytes, including collision-suffixed files;
        // a matching name alone must not embed somebody else's attachment.
        // Adapter reads also cover hidden conversation/attachment directories.
        // https://github.com/logancyang/obsidian-copilot/issues/2900
        if (arrayBufferToBase64(await app.vault.adapter.readBinary(candidate)) === base64) {
          path = candidate;
          reused = true;
          break;
        }
      }
      if (!reused) {
        try {
          // Hidden folders are absent from the vault cache. Adapter writes
          // work there, but must not overwrite an existing attachment.
          // https://github.com/logancyang/obsidian-copilot/issues/2900
          if (hidden) {
            if (await app.vault.adapter.exists(path)) throw new Error("File already exists.");
            await app.vault.adapter.writeBinary(path, bytes);
          } else {
            await app.vault.createBinary(path, bytes);
          }
        } catch (error) {
          // Concurrent saves can allocate the same path before either writes.
          // Only reuse that winner when its bytes match the uploaded image;
          // otherwise preserve the failure rather than embed another file.
          // https://github.com/logancyang/obsidian-copilot/issues/2900
          const existing = isFileAlreadyExistsError(error)
            ? await app.vault.adapter.readBinary(path).catch(() => null)
            : null;
          if (!existing || arrayBufferToBase64(existing) !== base64) throw error;
        }
      }
      // Root-relative Markdown also works when a configured folder contains
      // characters that terminate wikilinks or Markdown destinations.
      // https://github.com/logancyang/obsidian-copilot/issues/2900
      const linkPath = path
        .split("/")
        .map(encodeURIComponent)
        .join("/")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
      embeds.push(`![](/${linkPath})`);
    }
    prepared.push(
      embeds.length
        ? { ...message, message: [message.message, ...embeds].filter(Boolean).join("\n\n") }
        : message
    );
  }
  return prepared;
}
