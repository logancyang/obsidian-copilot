import { mockTFile } from "@/__tests__/mockObsidian";
import {
  prepareChatImagesForSave,
  preserveChatImageReferences,
  updateChatTranscript,
  stripChatImageReceipts,
} from "@/utils/chatImagePersistence";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { sha256 } from "@/utils/hash";
import { type TFile, type App } from "obsidian";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/2900";
const DESTINATION_ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3242";
const DATA = "iVBORw0KGgo=";
const IMAGE = { type: "image_url", image_url: { url: `data:image/png;base64,${DATA}` } };
const CHATS = "copilot/copilot-conversations";
const STORE = `${CHATS}/attachments`;

function makeApp() {
  const files = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const vault = {
    getAbstractFileByPath: jest.fn(() => null as TFile | null),
    getConfig: jest.fn(() => "Media"),
    createFolder: jest.fn(async (path: string) => {
      folders.add(path);
    }),
    createBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => {
      files.set(path, bytes);
      return { path };
    }),
    adapter: {
      exists: jest.fn(async (path: string) => files.has(path) || folders.has(path)),
      mkdir: jest.fn(async (path: string) => {
        folders.add(path);
      }),
      writeBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => {
        files.set(path, bytes);
      }),
      list: jest.fn(async (folder: string) => ({
        files: [...files.keys()].filter(
          (path) => path.slice(0, Math.max(0, path.lastIndexOf("/"))) === folder
        ),
        folders: [],
      })),
      readBinary: jest.fn(async (path: string) => files.get(path)!),
    },
  };
  return { files, folders, vault, app: { vault } as unknown as App };
}

function visibleMessage(message: string): string {
  return message
    .replace(/<!-- copilot-image:[\w-]+ -->\n/g, "")
    .replace(/\n<!-- \/copilot-image -->/g, "");
}

describe("chatImagePersistence", () => {
  describe("stripChatImageReceipts()", () => {
    it("leaves user-authored receipt-like comments untouched (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", () => {
      const text = "<!-- copilot-image:foo -->\nexample\n<!-- /copilot-image -->";
      expect(stripChatImageReceipts(text)).toBe(text);
    });
    it("strips CRLF receipt delimiters without exposing metadata (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", () => {
      expect(
        stripChatImageReceipts(
          "<!-- copilot-image:11111111-1111-4111-8111-111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\r\n![[image.png]]\r\n<!-- /copilot-image -->"
        )
      ).toBe("![[image.png]]");
    });
    it("exposes embeds without persistence metadata and keeps unrelated comments (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", () => {
      expect(
        stripChatImageReceipts(
          "<!-- authored -->\n<!-- copilot-image:11111111-1111-4111-8111-111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n![[image.png]]\n<!-- /copilot-image -->"
        )
      ).toBe("<!-- authored -->\n![[image.png]]");
    });
  });

  describe("prepareChatImagesForSave()", () => {
    it("does not adopt corrupted hash-named legacy bytes (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault, files } = makeApp();
      const path = `${STORE}/copilot-image-${sha256(DATA)}.png`;
      files.set(path, base64ToArrayBuffer("AQID"));
      const [saved] = await prepareChatImagesForSave(
        app,
        [{ sender: "user", message: "image", content: [IMAGE] }],
        CHATS,
        `**user**: image\n\n![](/${path})`
      );
      expect(saved.message).not.toContain(`![](/${path})`);
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
      expect(arrayBufferToBase64(vault.createBinary.mock.calls[0][1])).toBe(DATA);
    });
    it("retains a moved and deleted image receipt after CRLF normalization (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, files, vault } = makeApp();
      const messages = [{ sender: "user", message: "image", content: [IMAGE] }];
      const [saved] = await prepareChatImagesForSave(app, messages, CHATS);
      const moved = saved.message.replace(/!\[\]\([^)]+\)/, "![[organized.png]]");
      files.clear();
      const fresh = makeApp();
      const [restored] = await prepareChatImagesForSave(
        fresh.app,
        JSON.parse(JSON.stringify(messages)) as typeof messages,
        CHATS,
        `**user**: ${moved}`.replace(/\n/g, "\r\n")
      );
      expect(restored.message).toBe(moved);
      expect(fresh.vault.createBinary).not.toHaveBeenCalled();
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it("does not reuse an old receipt when a new upload occupies a deleted turn's ordinal (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault, files } = makeApp();
      const earlier = { sender: "user", message: "earlier" };
      const later = { sender: "user", message: "later", content: [IMAGE] };
      const [, saved] = await prepareChatImagesForSave(app, [earlier, later], CHATS);
      const moved = saved.message.replace(/!\[\]\([^)]+\)/, "![[moved.png]]");
      const [remaining] = await prepareChatImagesForSave(
        app,
        [later],
        CHATS,
        `**user**: earlier\n\n**user**: ${moved}`
      );
      files.clear();
      const replacement = {
        sender: "user",
        message: "new upload",
        content: [{ type: "image_url", image_url: { ...IMAGE.image_url } }],
      };
      const [, next] = await prepareChatImagesForSave(
        app,
        [later, replacement],
        CHATS,
        `**user**: ${remaining.message}`
      );
      expect(next.message).not.toContain("![[moved.png]]");
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
    });

    it("preserves a later moved image when an earlier user message is deleted (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault } = makeApp();
      const earlier = { sender: "user", message: "earlier" };
      const later = { sender: "user", message: "later", content: [IMAGE] };
      const [, saved] = await prepareChatImagesForSave(app, [earlier, later], CHATS);
      const moved = saved.message.replace(/!\[\]\([^)]+\)/, "![[moved.png]]");
      const [remaining] = await prepareChatImagesForSave(
        app,
        [later],
        CHATS,
        `**user**: earlier\n\n**user**: ${moved}`
      );
      expect(remaining.message).toBe(moved);
      const fresh = makeApp();
      const [reopened] = await prepareChatImagesForSave(
        fresh.app,
        [JSON.parse(JSON.stringify(later)) as typeof later],
        CHATS,
        `**user**: ${remaining.message}`
      );
      expect(reopened.message).toBe(moved);
      expect(fresh.vault.createBinary).not.toHaveBeenCalled();
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it.each(["![](/raw%name.png)", "![[deleted.png]]"])(
      "does not fail autosave when legacy identity cannot be read from %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)",
      async (embed) => {
        const { app, vault } = makeApp();
        Object.assign(app, {
          metadataCache: {
            getFirstLinkpathDest: jest.fn(() => mockTFile({ path: "deleted.png" })),
          },
        });
        vault.adapter.readBinary.mockRejectedValueOnce(new Error("file missing"));
        await expect(
          prepareChatImagesForSave(
            app,
            [{ sender: "user", message: "image", content: [IMAGE] }],
            CHATS,
            `**user**: image\n\n${embed}`
          )
        ).resolves.toHaveLength(1);
        expect(vault.createBinary).toHaveBeenCalledTimes(1);
      }
    );

    it("keeps concurrent writes in their captured conversation roots (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault, files } = makeApp();
      await Promise.all(
        ["one", "two"].map((root) =>
          prepareChatImagesForSave(
            app,
            [{ message: "", content: [JSON.parse(JSON.stringify(IMAGE))] }],
            `${root}/copilot-conversations`
          )
        )
      );
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
      expect([...files.keys()].some((path) => path.startsWith("one/"))).toBe(true);
      expect([...files.keys()].some((path) => path.startsWith("two/"))).toBe(true);
    });

    it("saves replacement bytes instead of adopting an unrelated legacy embed (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault, files } = makeApp();
      files.set("organized.png", base64ToArrayBuffer("AQID"));
      Object.assign(app, {
        metadataCache: {
          getFirstLinkpathDest: jest.fn(() => mockTFile({ path: "organized.png" })),
        },
      });
      const [saved] = await prepareChatImagesForSave(
        app,
        [{ sender: "user", message: "image", content: [IMAGE] }],
        CHATS,
        "**user**: image\n\n![[organized.png]]"
      );
      expect(saved.message).not.toContain("![[organized.png]]");
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it("preserves a missing legacy attachment whose hash filename proves upload identity (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault } = makeApp();
      const embed = `![[moved/copilot-image-${sha256(DATA)} 1.png]]`;
      const [saved] = await prepareChatImagesForSave(
        app,
        [{ sender: "user", message: "image", content: [IMAGE] }],
        CHATS,
        `**user**: image\n\n${embed}`
      );
      expect(saved.message).toContain(embed);
      expect(vault.createBinary).not.toHaveBeenCalled();
    });

    it("keeps persisted organizer links across native rehydration and uses user ordinals (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, files, vault } = makeApp();
      const messages = [{ sender: "user", message: "image", content: [IMAGE] }];
      const [first] = await prepareChatImagesForSave(app, messages, CHATS);
      const moved = first.message.replace(/!\[\]\([^)]+\)/, "![[organized.png]]");
      files.clear();
      const fresh = makeApp();
      const [, restored] = await prepareChatImagesForSave(
        fresh.app,
        [
          { sender: "ai", message: "backend detail" },
          ...(JSON.parse(JSON.stringify(messages)) as typeof messages),
        ],
        CHATS,
        `**user**: ${moved}`
      );
      expect(restored.message).toBe(moved);
      expect(fresh.vault.createBinary).not.toHaveBeenCalled();
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it.each(["", "text", "manual\n\n![[manual.png]]"])(
      "adopts renamed legacy suffix embeds for message %j (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)",
      async (message) => {
        const { app, vault, files } = makeApp();
        files.set("organized.png", base64ToArrayBuffer(DATA));
        Object.assign(app, {
          metadataCache: {
            getFirstLinkpathDest: jest.fn(() => mockTFile({ path: "organized.png" })),
          },
        });
        const [restored] = await prepareChatImagesForSave(
          app,
          [{ sender: "user", message, content: [IMAGE] }],
          CHATS,
          `**user**: ${message}\n\n![](../organized.png)\n[Timestamp: time]`
        );
        expect(visibleMessage(restored.message)).toBe(
          [message, "![](../organized.png)"].filter(Boolean).join("\n\n")
        );
        expect(restored.message).toContain("<!-- copilot-image:");
        expect(vault.createBinary).not.toHaveBeenCalled();
      }
    );

    it("retries failed initial writes but does not retry after successful persistence (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault, files } = makeApp();
      vault.createBinary.mockRejectedValueOnce(new Error("disk full"));
      const messages = [{ message: "", content: [IMAGE] }];
      await expect(prepareChatImagesForSave(app, messages, CHATS)).rejects.toThrow("disk full");
      await prepareChatImagesForSave(app, messages, CHATS);
      files.clear();
      await prepareChatImagesForSave(app, messages, CHATS);
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
      expect(files.size).toBe(0);
    });

    it("writes a new upload of deleted bytes in a later message (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, vault, files } = makeApp();
      const first = {
        sender: "user",
        message: "first",
        content: [JSON.parse(JSON.stringify(IMAGE))],
      };
      const [saved] = await prepareChatImagesForSave(app, [first], CHATS);
      files.clear();
      const second = {
        sender: "user",
        message: "second",
        content: [JSON.parse(JSON.stringify(IMAGE))],
      };
      await prepareChatImagesForSave(app, [first, second], CHATS, `**user**: ${saved.message}`);
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
      expect(files.size).toBe(1);
    });

    it.each(["unique.png", "folder/duplicate.png"])(
      "uses the host's unambiguous wiki path %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)",
      async (link) => {
        const { app, vault } = makeApp();
        const file = mockTFile({ path: "unique.png" });
        vault.getAbstractFileByPath.mockReturnValue(file);
        const fileToLinktext = jest.fn(() => link);
        Object.assign(app, { metadataCache: { fileToLinktext } });
        const [saved] = await prepareChatImagesForSave(
          app,
          [{ message: "", content: [IMAGE] }],
          CHATS,
          "",
          `${CHATS}/chat.md`
        );
        expect(visibleMessage(saved.message)).toBe(`![[${link}]]`);
        expect(fileToLinktext).toHaveBeenCalledWith(file, `${CHATS}/chat.md`, false);
      }
    );

    it("does not recreate a moved or deleted live upload (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const { app, files, vault } = makeApp();
      const messages = [{ message: "image", content: [IMAGE] }];
      const saved = await prepareChatImagesForSave(app, messages, CHATS);
      files.clear();
      expect(await prepareChatImagesForSave(app, messages, CHATS)).toEqual(saved);
      expect(files.size).toBe(0);
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it(`embeds every uploaded image beside its own message without mutating live content (${ISSUE})`, async () => {
      const { app, files, vault } = makeApp();
      const messages = [
        { id: "1", message: "First image", content: [IMAGE] },
        {
          id: "2",
          message: "",
          content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } }],
        },
      ];
      const original = JSON.stringify(messages);
      const prepared = await prepareChatImagesForSave(app, messages, CHATS);
      const paths = [...files.keys()];
      expect(visibleMessage(prepared[0].message)).toBe(`First image\n\n![](/${paths[0]})`);
      expect(visibleMessage(prepared[1].message)).toBe(`![](/${paths[1]})`);
      expect(paths[1]).toMatch(/\.jpg$/);
      expect(arrayBufferToBase64(files.get(paths[0])!)).toBe(DATA);
      expect(JSON.stringify(messages)).toBe(original);
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
    });

    it(`stores attachments under the conversations folder instead of the vault attachment setting (${DESTINATION_ISSUE})`, async () => {
      const { app, files, folders, vault } = makeApp();
      await prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], CHATS);
      expect([...files.keys()][0]).toBe(`${STORE}/copilot-image-${sha256(DATA)}.png`);
      expect(folders).toContain(STORE);
      expect(vault.getConfig).not.toHaveBeenCalled();
    });

    it(`re-roots the attachment store when the Copilot root is relocated (${DESTINATION_ISSUE})`, async () => {
      const { app, files } = makeApp();
      await prepareChatImagesForSave(
        app,
        [{ message: "", content: [IMAGE] }],
        "team/ai/copilot-conversations"
      );
      expect([...files.keys()][0]).toBe(
        `team/ai/copilot-conversations/attachments/copilot-image-${sha256(DATA)}.png`
      );
    });

    it(`creates no attachment folder for a conversation without uploaded images (${DESTINATION_ISSUE})`, async () => {
      const { app, folders, vault } = makeApp();
      await prepareChatImagesForSave(app, [{ message: "no images here" }], CHATS);
      expect(folders.size).toBe(0);
      expect(vault.createFolder).not.toHaveBeenCalled();
    });

    it(`writes and reuses attachments under a hidden Copilot root through the adapter (${ISSUE})`, async () => {
      const { app, files, vault } = makeApp();
      vault.createBinary.mockRejectedValue(new Error("not in vault cache"));
      const messages = [{ message: "", content: [IMAGE] }];
      const hiddenChats = ".copilot/copilot-conversations";
      const first = await prepareChatImagesForSave(app, messages, hiddenChats);
      expect(visibleMessage(first[0].message)).toBe(
        `![](/${hiddenChats}/attachments/copilot-image-${sha256(DATA)}.png)`
      );
      expect(await prepareChatImagesForSave(app, messages, hiddenChats)).toEqual(first);
      expect(files.size).toBe(1);
      expect(arrayBufferToBase64([...files.values()][0])).toBe(DATA);
      expect(vault.adapter.writeBinary).toHaveBeenCalledTimes(1);
      expect(vault.createBinary).not.toHaveBeenCalled();
    });

    it.each([DATA, "AQID"])(
      `preserves a hidden attachment created after allocation with bytes %s (${ISSUE})`,
      async (winner) => {
        const { app, files, vault } = makeApp();
        vault.adapter.list.mockImplementation(async () => {
          files.set(
            `.copilot/copilot-conversations/attachments/copilot-image-${sha256(DATA)}.png`,
            base64ToArrayBuffer(winner)
          );
          return { files: [], folders: [] };
        });
        const saving = prepareChatImagesForSave(
          app,
          [{ message: "", content: [IMAGE] }],
          ".copilot/copilot-conversations"
        );
        if (winner === DATA) await expect(saving).resolves.toHaveLength(1);
        else await expect(saving).rejects.toThrow("File already exists.");
        expect(arrayBufferToBase64([...files.values()][0])).toBe(winner);
        expect(vault.adapter.writeBinary).not.toHaveBeenCalled();
      }
    );

    it.each(["Folder already exists.", "permission denied"])(
      `handles attachment folder creation failure %s (${ISSUE})`,
      async (error) => {
        const { app, vault } = makeApp();
        vault.adapter.mkdir.mockRejectedValueOnce(new Error(error));
        const saving = prepareChatImagesForSave(
          app,
          [{ message: "", content: [IMAGE] }],
          ".copilot/copilot-conversations"
        );
        if (error === "Folder already exists.") await expect(saving).resolves.toHaveLength(1);
        else {
          await expect(saving).rejects.toThrow(error);
          expect(vault.adapter.writeBinary).not.toHaveBeenCalled();
        }
      }
    );

    it(`propagates hidden attachment write failures (${ISSUE})`, async () => {
      const { app, vault } = makeApp();
      vault.adapter.writeBinary.mockRejectedValueOnce(new Error("disk full"));
      await expect(
        prepareChatImagesForSave(
          app,
          [{ message: "", content: [IMAGE] }],
          ".copilot/copilot-conversations"
        )
      ).rejects.toThrow("disk full");
    });

    it.each([
      ["x-icon", "ico"],
      ["vnd.microsoft.icon", "ico"],
      ["svg+xml", "svg"],
      ["x-ms-bmp", "bmp"],
      ["vnd.adobe.photoshop", "vndadobephotoshop"],
    ])(`saves image/%s uploads with a safe %s extension (${ISSUE})`, async (subtype, extension) => {
      const { app, files } = makeApp();
      await prepareChatImagesForSave(
        app,
        [
          {
            message: "",
            content: [
              { type: "image_url", image_url: { url: `data:image/${subtype};base64,${DATA}` } },
            ],
          },
        ],
        CHATS
      );
      expect([...files.keys()][0]).toBe(`${STORE}/copilot-image-${sha256(DATA)}.${extension}`);
    });

    it(`accepts unpadded base64 without changing the uploaded bytes (${ISSUE})`, async () => {
      const { app, files } = makeApp();
      await prepareChatImagesForSave(
        app,
        [
          {
            message: "",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${DATA.replace(/=+$/, "")}` },
              },
            ],
          },
        ],
        CHATS
      );
      expect(arrayBufferToBase64([...files.values()][0])).toBe(DATA);
    });

    it(`reuses attachments within a message and across saves, including filename collisions (${ISSUE})`, async () => {
      const { app, files, vault } = makeApp();
      const collision = `${STORE}/copilot-image-${sha256(DATA)}.png`;
      files.set(collision, base64ToArrayBuffer("AQID"));
      const messages = [{ message: "two", content: [IMAGE, IMAGE] }];
      const first = await prepareChatImagesForSave(app, messages, CHATS);
      const second = await prepareChatImagesForSave(app, messages, CHATS);
      const expectedPath = collision.replace(".png", " 1.png");
      expect(visibleMessage(first[0].message)).toBe(
        `two\n\n![](/${expectedPath.replace(" ", "%20")})\n\n![](/${expectedPath.replace(" ", "%20")})`
      );
      expect(second).toEqual(first);
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
      expect(arrayBufferToBase64(files.get(collision)!)).toBe("AQID");
    });

    it(`completes both concurrent saves when the winning attachment contains the same bytes (${ISSUE})`, async () => {
      const { app, files, vault } = makeApp();
      const messages = [{ message: "", content: [IMAGE] }];
      const results = await Promise.all([
        prepareChatImagesForSave(app, messages, CHATS),
        prepareChatImagesForSave(app, messages, CHATS),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(visibleMessage(results[0][0].message)).toBe(
        `![](/${STORE}/copilot-image-${sha256(DATA)}.png)`
      );
      expect(files.size).toBe(1);
      expect(arrayBufferToBase64([...files.values()][0])).toBe(DATA);
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it.each(["different", "unreadable"])(
      `preserves the original collision error when the winning attachment is %s (${ISSUE})`,
      async (winner) => {
        const { app, files, vault } = makeApp();
        const collision = new Error("File already exists.");
        vault.createBinary.mockImplementation(async (path) => {
          files.set(path, base64ToArrayBuffer("AQID"));
          throw collision;
        });
        if (winner === "unreadable")
          vault.adapter.readBinary.mockRejectedValueOnce(new Error("cannot read"));
        await expect(
          prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], CHATS)
        ).rejects.toBe(collision);
      }
    );

    it(`escapes folder characters that could break an image embed (${ISSUE})`, async () => {
      const { app } = makeApp();
      const prepared = await prepareChatImagesForSave(
        app,
        [{ message: "", content: [IMAGE] }],
        "notes ] # % (reference)/copilot-conversations"
      );
      expect(visibleMessage(prepared[0].message)).toBe(
        `![](/notes%20%5D%20%23%20%25%20%28reference%29/copilot-conversations/attachments/copilot-image-${sha256(DATA)}.png)`
      );
    });

    it(`leaves text, existing embeds, remote images, and non-image content unchanged (${ISSUE})`, async () => {
      const { app, vault } = makeApp();
      const messages = [
        { message: "text ![[existing.png]]" },
        {
          message: "other",
          content: [
            null,
            4,
            {},
            { type: "text", text: "hello" },
            { type: "image_url" },
            { type: "image_url", image_url: {} },
            { type: "image_url", image_url: { url: "https://example.com/image.png" } },
            { type: "image_url", image_url: { url: "data:application/pdf;base64,AQID" } },
          ],
        },
      ];
      const prepared = await prepareChatImagesForSave(app, messages, CHATS);
      expect(prepared).toEqual(messages);
      expect(prepared[0]).toBe(messages[0]);
      expect(vault.createBinary).not.toHaveBeenCalled();
    });

    it.each([
      "data:image/png;base64,",
      "data:image/png;base64,???",
      "data:image/png;base64,AAAAA",
      "data:image/png;base64,AQID=",
      "data:image/png;base64,AQ=",
      "data:image/png;base64,AR==",
      "data:image/png;base64,A",
    ])(
      `rejects malformed uploaded image %j without writing an attachment (${ISSUE})`,
      async (url) => {
        const { app, vault } = makeApp();
        await expect(
          prepareChatImagesForSave(
            app,
            [{ message: "", content: [{ type: "image_url", image_url: { url } }] }],
            CHATS
          )
        ).rejects.toThrow("invalid uploaded image");
        expect(vault.createBinary).not.toHaveBeenCalled();
      }
    );

    it(`rejects attachment write failures so the caller cannot save an incomplete transcript (${ISSUE})`, async () => {
      const { app, vault } = makeApp();
      vault.createBinary.mockRejectedValueOnce(new Error("disk full"));
      await expect(
        prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], CHATS)
      ).rejects.toThrow("disk full");
    });
  });
  describe("preserveChatImageReferences()", () => {
    it("restores disk-only markers after clean loading (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", () => {
      const original =
        "**user**: image\n\n<!-- copilot-image:11111111-1111-4111-8111-111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n![[old.png]]\n<!-- /copilot-image -->\n[Timestamp: now]";
      const authored = original.replace(
        "image\n\n",
        "image\n\n<!-- copilot-image:foo -->\nexample\n<!-- /copilot-image -->\n\n"
      );
      expect(
        preserveChatImageReferences(
          stripChatImageReceipts(authored),
          authored.replace("old.png", "moved.png"),
          authored
        )
      ).toBe(authored.replace("old.png", "moved.png"));
      const moved = original.replace("old.png", "moved.png");
      const clean = visibleMessage(original);
      expect(preserveChatImageReferences(clean, moved, original)).toBe(moved);
      expect(preserveChatImageReferences(original, moved, original.replace(/\n/g, "\r\n"))).toBe(
        moved
      );
      expect(
        preserveChatImageReferences(
          clean,
          moved.replace(/\n/g, "\r\n"),
          original.replace(/\n/g, "\r\n")
        ).replace(/\r\n/g, "\n")
      ).toBe(moved);
    });

    it("keeps the current receipt link when an organizer rewrites during save (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", () => {
      const next =
        "**user**: image\n\n<!-- copilot-image:11111111-1111-4111-8111-111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n![[old.png]]\n<!-- /copilot-image -->\n[Timestamp: now]";
      expect(preserveChatImageReferences(next, next.replace("old.png", "moved.png"))).toBe(
        next.replace("old.png", "moved.png")
      );
    });
    it("preserves host-updated legacy embeds after reopening without changing other text (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", () => {
      const next = "**user**: image\n\n![](/old.png)\n[Timestamp: now]\n\n**ai**: New answer";
      const existing = next
        .replace("![](/old.png)", "![[moved.png]]")
        .replace("New answer", "Old answer");
      expect(preserveChatImageReferences(next, existing, next)).toBe(
        next.replace("![](/old.png)", "![[moved.png]]")
      );
      expect(preserveChatImageReferences(next.replace("image", "edited"), existing, next)).toBe(
        next.replace("image", "edited")
      );
      const editedEmbed = next.replace("old.png", "intentional.png");
      expect(preserveChatImageReferences(editedEmbed, existing, next)).toBe(editedEmbed);
    });
  });

  describe("updateChatTranscript()", () => {
    it.each([true, false])(
      "preserves a link updated immediately before writing an indexed=%s transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)",
      async (indexed) => {
        const { app, vault } = makeApp();
        const file = mockTFile({ path: "chat.md" });
        vault.getAbstractFileByPath.mockReturnValue(indexed ? file : null);
        const next =
          "<!-- copilot-image:11111111-1111-4111-8111-111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n![[old.png]]\n<!-- /copilot-image -->";
        let disk = next.replace("old.png", "moved.png");
        const process = jest.fn(async (_file: TFile, update: (content: string) => string) => {
          disk = update(disk);
          return disk;
        });
        const write = jest.fn(async (_path: string, value: string) => {
          disk = value;
        });
        Object.assign(vault, { process });
        Object.assign(vault.adapter, { read: jest.fn(async () => disk), write });
        await updateChatTranscript(app, file.path, next);
        expect(disk).toBe(next.replace("old.png", "moved.png"));
        expect(indexed ? process : write).toHaveBeenCalledTimes(1);
      }
    );
  });
});
