import { deriveConversationAttachmentsFolder } from "@/settings/copilotFolder";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { sha256 } from "@/utils/hash";
import { isFileAlreadyExistsError } from "@/utils/vaultAdapterUtils";
import { TFile, type App } from "obsidian";

const IMAGE_EXTENSIONS = new Map([
  ["jpeg", "jpg"],
  ["svg+xml", "svg"],
  ["x-icon", "ico"],
  ["vnd.microsoft.icon", "ico"],
  ["x-ms-bmp", "bmp"],
]);

interface MessageWithImages {
  message: string;
  sender?: string;
  content?: unknown[];
}

// Deleting a saved asset must not turn it into a new upload.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/533
const savedUploads = new WeakMap<App, Map<string, Promise<string>>>();
const pendingUploads = new WeakMap<App, Map<string, Promise<string>>>();
const RECEIPT =
  /<!-- copilot-image:([a-f0-9]{64}) -->\r?\n([\s\S]*?)\r?\n<!-- \/copilot-image -->/g;

const EMBED = /^!\[\[[^\r\n]+\]\]$|^!\[[^\r\n]*\]\([^\r\n]+\)$/gm;

function restoreChatImageReceipts(next: string, loaded: string): string {
  const byEmbed = new Map([...loaded.matchAll(RECEIPT)].map((m) => [m[2], m[0]]));
  return next.replace(
    new RegExp(`${RECEIPT.source}|${EMBED.source}`, "gm"),
    (value) => byEmbed.get(value) ?? value
  );
}

export function stripChatImageReceipts(text: string): string {
  return text.replace(RECEIPT, "$2");
}

export function preserveChatImageReferences(next: string, existing: string, loaded = ""): string {
  const receipts = new Map([...existing.matchAll(RECEIPT)].map((m) => [m[1], m[0]]));
  const merged = restoreChatImageReceipts(next, loaded).replace(
    RECEIPT,
    (receipt, hash: string) => receipts.get(hash) ?? receipt
  );
  const userBlock = /\*\*user\*\*: ([\s\S]*?)(?=\n\*\*(?:user|ai)\*\*: |$)/g;
  const previous = [...existing.matchAll(userBlock)];
  const baseline = [...loaded.matchAll(userBlock)];
  const embed = EMBED;
  const textOnly = (value: string) =>
    stripChatImageReceipts(value).replace(embed, "").replace(/\s+/g, " ").trim();
  let user = 0;
  return merged.replace(userBlock, (block: string) => {
    const old = previous[user]?.[0];
    const original = baseline[user++]?.[0];
    if (!old || !original || block.match(RECEIPT)) return block;
    const oldEmbeds = old.match(new RegExp(`${RECEIPT.source}|${embed.source}`, "gm")) ?? [];
    const originalEmbeds = stripChatImageReceipts(original).match(embed) ?? [];
    const newEmbeds = block.match(embed) ?? [];
    if (
      textOnly(old) !== textOnly(block) ||
      oldEmbeds.length !== newEmbeds.length ||
      newEmbeds.some((value, i) => value !== originalEmbeds[i])
    )
      return block;
    let index = 0;
    return block.replace(embed, () => oldEmbeds[index++]);
  });
}

export async function updateChatTranscript(
  app: App,
  path: string,
  next: string,
  loaded = ""
): Promise<string> {
  const baseline = restoreChatImageReceipts(next, loaded);
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.vault.process(file, (current) => preserveChatImageReferences(next, current, loaded));
  } else {
    await app.vault.adapter.write(
      path,
      preserveChatImageReferences(next, await app.vault.adapter.read(path), loaded)
    );
  }
  return baseline;
}

export async function prepareChatImagesForSave<T extends MessageWithImages>(
  app: App,
  messages: T[],
  conversationsFolder: string,
  existingContent = "",
  sourcePath = ""
): Promise<T[]> {
  const prepared: T[] = [];
  const folder = deriveConversationAttachmentsFolder(conversationsFolder);
  // Copilot roots may be hidden (e.g. `.copilot`) and hidden folders are absent from the vault cache, so go through the adapter.
  // https://github.com/logancyang/obsidian-copilot/issues/2900
  const hidden = folder.split("/").some((part) => part.startsWith("."));
  const prefix = `${folder}/`;

  const receipts = new Map([...existingContent.matchAll(RECEIPT)].map((m) => [m[1], m[2]]));
  const savedUsers = [
    ...existingContent.matchAll(/\*\*user\*\*: ([\s\S]*?)(?=\n\*\*(?:user|ai)\*\*: |$)/g),
  ];
  let userIndex = -1;
  let savedImages = savedUploads.get(app);
  if (!savedImages) savedUploads.set(app, (savedImages = new Map<string, Promise<string>>()));
  let pending = pendingUploads.get(app);
  if (!pending) pendingUploads.set(app, (pending = new Map<string, Promise<string>>()));

  for (const message of messages) {
    if (!message.sender || message.sender === "user") userIndex++;
    let imageIndex = 0;
    const oldBody = savedUsers[userIndex]?.[1]
      .replace(/\n\[(?:Context|Timestamp):[^\n]*\]/g, "")
      .trim();
    const suffix = oldBody?.startsWith(message.message)
      ? oldBody.slice(message.message.length).trim()
      : "";
    const legacyEmbeds = suffix.split(/\n\s*\n/).filter(Boolean);
    const uploads = (message.content ?? []).flatMap((item) => {
      if (!item || typeof item !== "object" || !("type" in item) || item.type !== "image_url")
        return [];
      const image = "image_url" in item ? item.image_url : undefined;
      return image &&
        typeof image === "object" &&
        "url" in image &&
        typeof image.url === "string" &&
        image.url.startsWith("data:image/")
        ? [image as { url: string }]
        : [];
    });
    const canAdoptLegacy =
      legacyEmbeds.length === uploads.length &&
      legacyEmbeds.every((embed) => /^!\[\[[^\n]+\]\]$|^!\[[^\n]*\]\([^\n]+\)$/.test(embed));
    const embeds: string[] = [];
    for (const image of uploads) {
      const match = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image.url);
      if (!match) throw new Error("Cannot save an invalid uploaded image.");
      const bytes = base64ToArrayBuffer(match[2]);
      const base64 = arrayBufferToBase64(bytes);
      const subtype = match[1].toLowerCase();
      const extension = IMAGE_EXTENSIONS.get(subtype) ?? subtype.replace(/[^a-z0-9]/g, "");
      if (
        !bytes.byteLength ||
        !extension ||
        base64.replace(/=+$/, "") !== match[2].replace(/=+$/, "") ||
        (match[2].includes("=") && match[2] !== base64)
      ) {
        throw new Error("Cannot save an invalid uploaded image.");
      }
      const hash = sha256(base64);
      const name = `copilot-image-${hash}`;
      const savedKey = `${sourcePath || conversationsFolder}\0${hash}`;
      let saved = savedImages.get(savedKey);
      const ordinal = imageIndex++;
      let persisted = receipts.get(hash);
      if (persisted === undefined && canAdoptLegacy) {
        try {
          const embed = legacyEmbeds[ordinal];
          const target = embed.startsWith("![[")
            ? embed.slice(3, -2).split("|")[0]
            : decodeURIComponent(embed.slice(embed.indexOf("](") + 2, -1).replace(/^<|>$/g, ""));
          // Readable legacy files must match bytes even with a hash filename; only missing targets may rely on the filename as a receipt.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
          const file = app.metadataCache?.getFirstLinkpathDest(target, sourcePath);
          const path = file?.path ?? target.replace(/^\//, "");
          if (await app.vault.adapter.exists(path)) {
            if (arrayBufferToBase64(await app.vault.adapter.readBinary(path)) === base64)
              persisted = embed;
          } else if (
            new RegExp(`^${name}(?: \\d+)?\\.${extension}$`).test(target.split("/").pop() ?? "")
          ) {
            persisted = embed;
          }
        } catch {
          // An unreadable or malformed legacy link cannot prove upload identity.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
        }
      }

      // The saved receipt stays authoritative even when its target is missing; deleting an attachment must never trigger another upload.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
      if (persisted !== undefined) {
        saved = Promise.resolve(persisted);
      } else if (!saved) {
        const pendingKey = `${prefix}${name}.${extension}`;
        let writing = pending.get(pendingKey);
        if (!writing) {
          writing = writeImage();
          pending.set(pendingKey, writing);
          void writing.finally(() => pending.delete(pendingKey)).catch(() => {});
        }
        saved = writing.then(formatLink);
        void saved.catch(() => savedImages.delete(savedKey));
      }
      savedImages.set(savedKey, saved);
      embeds.push(`<!-- copilot-image:${hash} -->\n${await saved}\n<!-- /copilot-image -->`);

      async function writeImage(): Promise<string> {
        let current = "";
        for (const part of folder.split("/").filter(Boolean)) {
          current = current ? `${current}/${part}` : part;
          if (!(await app.vault.adapter.exists(current))) {
            try {
              if (hidden) await app.vault.adapter.mkdir(current);
              else await app.vault.createFolder(current);
            } catch (error) {
              if (!isFileAlreadyExistsError(error)) throw error;
            }
          }
        }
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
          // A matching name alone must not embed somebody else's attachment, so reuse only matching bytes.
          // https://github.com/logancyang/obsidian-copilot/issues/2900
          if (arrayBufferToBase64(await app.vault.adapter.readBinary(candidate)) === base64) {
            path = candidate;
            reused = true;
            break;
          }
        }
        if (!reused) {
          try {
            // Hidden folders are absent from the vault cache; adapter writes must not overwrite an existing attachment.
            // https://github.com/logancyang/obsidian-copilot/issues/2900
            if (hidden) {
              if (await app.vault.adapter.exists(path)) throw new Error("File already exists.");
              await app.vault.adapter.writeBinary(path, bytes);
            } else {
              await app.vault.createBinary(path, bytes);
            }
          } catch (error) {
            // Concurrent saves can allocate the same path; reuse the winner only when its bytes match.
            // https://github.com/logancyang/obsidian-copilot/issues/2900
            const existing = isFileAlreadyExistsError(error)
              ? await app.vault.adapter.readBinary(path).catch(() => null)
              : null;
            if (!existing || arrayBufferToBase64(existing) !== base64) throw error;
          }
        }
        return path;
      }

      function formatLink(path: string): string {
        // Root-relative Markdown survives folders whose characters terminate wikilinks or Markdown destinations.
        // https://github.com/logancyang/obsidian-copilot/issues/2900
        const linkPath = path
          .split("/")
          .map(encodeURIComponent)
          .join("/")
          .replace(/\(/g, "%28")
          .replace(/\)/g, "%29");
        const file = app.vault.getAbstractFileByPath(path);
        if (!hidden && !/[[\]#^|\\\r\n]/.test(path) && file instanceof TFile) {
          const link = app.metadataCache.fileToLinktext(file, sourcePath, false);
          return `![[${link}]]`;
        }
        return `![](/${linkPath})`;
      }
    }
    prepared.push(
      embeds.length
        ? { ...message, message: [message.message, ...embeds].filter(Boolean).join("\n\n") }
        : message
    );
  }
  return prepared;
}
