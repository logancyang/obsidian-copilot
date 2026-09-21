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

// Remember successful writes by conversation and content, including fresh objects
// returned by a backend. Deleting a saved asset must not turn it into a new upload.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/533
const savedUploads = new WeakMap<App, Map<string, Promise<string>>>();
const pendingUploads = new WeakMap<App, Map<string, Promise<string>>>();
const RECEIPT =
  /<!-- copilot-image:([a-f0-9]{64}) -->\r?\n([\s\S]*?)\r?\n<!-- \/copilot-image -->/g;

const EMBED = /^!\[\[[^\r\n]+\]\]$|^!\[[^\r\n]*\]\([^\r\n]+\)$/gm;

// The loaded transcript retains hash-to-link associations while display text stays
// clean. Restore those associations without depending on message text or position.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/533
function restoreChatImageReceipts(next: string, loaded: string): string {
  const byEmbed = new Map([...loaded.matchAll(RECEIPT)].map((m) => [m[2], m[0]]));
  return next.replace(
    new RegExp(`${RECEIPT.source}|${EMBED.source}`, "gm"),
    (value) => byEmbed.get(value) ?? value
  );
}

/** Keep on-disk upload receipts out of display text, editors, and model history. */
export function stripChatImageReceipts(text: string): string {
  return text.replace(RECEIPT, "$2");
}

/**
 * Preserve organizer-updated embeds at the moment an existing transcript is written.
 * @param next - Newly serialized live transcript.
 * @param existing - On-disk transcript, including host link updates.
 * @param loaded - Last accepted live transcript, used to recognize user edits.
 */
export function preserveChatImageReferences(next: string, existing: string, loaded = ""): string {
  const receipts = new Map([...existing.matchAll(RECEIPT)].map((m) => [m[1], m[0]]));
  const merged = restoreChatImageReceipts(next, loaded).replace(
    RECEIPT,
    (receipt, hash: string) => receipts.get(hash) ?? receipt
  );
  // Legacy notes have no content identity. Preserve their host-updated links only
  // at unchanged user positions; new receipts above do not need this fallback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
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

/**
 * Atomically preserve host link changes when updating visible conversation notes.
 * Hidden notes use the adapter because Obsidian does not index their links.
 * @param app - Vault owning the transcript.
 * @param path - Existing note path.
 * @param next - Newly serialized live transcript.
 * @param loaded - Last accepted live transcript.
 * @returns Live transcript with receipt metadata retained for the next save.
 */
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

/**
 * Return save-only copies with vault embeds and durable upload receipts.
 * Initial write failures reject the save; saved images are never recreated.
 * @param app - Vault owning the attachments.
 * @param messages - Live display messages with uploaded image data URLs.
 * @param conversationsFolder - Resolved folder owning the attachment store.
 * @param existingContent - Latest transcript, containing durable upload receipts.
 * @param sourcePath - Conversation note path for resolving wiki links.
 */
export async function prepareChatImagesForSave<T extends MessageWithImages>(
  app: App,
  messages: T[],
  conversationsFolder: string,
  existingContent = "",
  sourcePath = ""
): Promise<T[]> {
  const prepared: T[] = [];
  const folder = deriveConversationAttachmentsFolder(conversationsFolder);
  // A Copilot root may be hidden (e.g. `.copilot`), and hidden folders are
  // absent from the vault cache, so those reads and writes go through the
  // adapter: https://github.com/logancyang/obsidian-copilot/issues/2900
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
    // Legacy transcripts appended embeds after the exact original message. Only
    // adopt that suffix, so manually authored embeds aren't mistaken for uploads.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
    const oldBody = savedUsers[userIndex]?.[1]
      .replace(/\n\[(?:Context|Timestamp):[^\n]*\]/g, "")
      .trim();
    const suffix = oldBody?.startsWith(message.message)
      ? oldBody.slice(message.message.length).trim()
      : "";
    const legacyEmbeds = suffix.split(/\n\s*\n/).filter(Boolean);
    const uploads = (message.content ?? []).flatMap((item) => {
      // Remote URLs and non-image rich content are not attachment downloads.
      // https://github.com/logancyang/obsidian-copilot/issues/2900
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
          // Readable legacy files must match bytes, even with a hash filename.
          // Only missing targets may rely on the filename as an upload receipt.
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

      // The saved receipt remains authoritative even when its target is missing;
      // deleting or organizing an attachment must never trigger another upload.
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
              // Concurrent saves may create the attachment folder first.
              // https://github.com/logancyang/obsidian-copilot/issues/2900
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
          // Initial uploads reuse matching bytes, including collision-suffixed files;
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
        return path;
      }

      // Format for each source note; concurrent saves share only the file write.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
      function formatLink(path: string): string {
        // Root-relative Markdown also works when a configured folder contains
        // characters that terminate wikilinks or Markdown destinations.
        // https://github.com/logancyang/obsidian-copilot/issues/2900
        const linkPath = path
          .split("/")
          .map(encodeURIComponent)
          .join("/")
          .replace(/\(/g, "%28")
          .replace(/\)/g, "%29");
        // Let Obsidian choose a basename only when it resolves unambiguously.
        // Unsafe wiki syntax and hidden paths retain the encoded Markdown form.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/533
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
