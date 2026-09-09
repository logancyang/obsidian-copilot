import { prepareChatImagesForSave } from "@/utils/chatImagePersistence";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { sha256 } from "@/utils/hash";
import type { App } from "obsidian";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/2900";
const DATA = "iVBORw0KGgo=";
const IMAGE = { type: "image_url", image_url: { url: `data:image/png;base64,${DATA}` } };

function makeApp(attachmentFolder = "attachments") {
  const files = new Map<string, ArrayBuffer>();
  const vault = {
    getAvailablePathForAttachments: jest.fn(
      async (
        name: string,
        extension: string,
        source: {
          parent: { path: string; getParentPrefix(): string };
        }
      ) => {
        const folder =
          attachmentFolder === "."
            ? source.parent.path
            : attachmentFolder.startsWith("./")
              ? `${source.parent.getParentPrefix()}${attachmentFolder.slice(2)}`
              : attachmentFolder;
        const prefix = folder ? `${folder}/` : "";
        let path = `${prefix}${name}.${extension}`;
        let suffix = 1;
        while (files.has(path)) path = `${prefix}${name} ${suffix++}.${extension}`;
        return path;
      }
    ),
    createBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => {
      files.set(path, bytes);
      return { path };
    }),
    adapter: {
      list: jest.fn(async (folder: string) => ({
        files: [...files.keys()].filter(
          (path) => path.slice(0, Math.max(0, path.lastIndexOf("/"))) === folder
        ),
        folders: [],
      })),
      readBinary: jest.fn(async (path: string) => files.get(path)!),
    },
  };
  return { files, vault, app: { vault } as unknown as App };
}

describe("chatImagePersistence", () => {
  describe("prepareChatImagesForSave()", () => {
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
      const prepared = await prepareChatImagesForSave(app, messages, "chats/new.md");
      const paths = [...files.keys()];
      expect(prepared[0].message).toBe(`First image\n\n![](/${paths[0]})`);
      expect(prepared[1].message).toBe(`![](/${paths[1]})`);
      expect(paths[1]).toMatch(/\.jpg$/);
      expect(arrayBufferToBase64(files.get(paths[0])!)).toBe(DATA);
      expect(JSON.stringify(messages)).toBe(original);
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
    });

    it.each(["attachments", ".", "./images", ""])(
      `honors attachment folder %j before a new transcript exists (${ISSUE})`,
      async (setting) => {
        const { app, files, vault } = makeApp(setting);
        await prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], "chats/new.md");
        const folder =
          setting === "." ? "chats" : setting === "./images" ? "chats/images" : setting;
        expect([...files.keys()][0]).toBe(
          `${folder ? `${folder}/` : ""}copilot-image-${sha256(DATA)}.png`
        );
        const source = vault.getAvailablePathForAttachments.mock.calls[0][2];
        expect(source.parent.path).toBe("chats");
        expect(source.parent.getParentPrefix()).toBe("chats/");
      }
    );

    it(`supports relative attachments for hidden and vault-root transcripts (${ISSUE})`, async () => {
      for (const notePath of [".copilot/chats/new.md", "new.md"]) {
        const { app, files } = makeApp("./images");
        await prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], notePath);
        const prefix = notePath.startsWith(".") ? ".copilot/chats/" : "";
        expect([...files.keys()][0]).toBe(`${prefix}images/copilot-image-${sha256(DATA)}.png`);
      }
    });

    it(`reuses attachments within a message and across saves, including filename collisions (${ISSUE})`, async () => {
      const { app, files, vault } = makeApp();
      const collision = `attachments/copilot-image-${sha256(DATA)}.png`;
      files.set(collision, base64ToArrayBuffer("AQID"));
      const messages = [{ message: "two", content: [IMAGE, IMAGE] }];
      const first = await prepareChatImagesForSave(app, messages, "chats/new.md");
      const second = await prepareChatImagesForSave(app, messages, "chats/new.md");
      const expectedPath = collision.replace(".png", " 1.png");
      expect(first[0].message).toBe(
        `two\n\n![](/${expectedPath.replace(" ", "%20")})\n\n![](/${expectedPath.replace(" ", "%20")})`
      );
      expect(second).toEqual(first);
      expect(vault.createBinary).toHaveBeenCalledTimes(1);
      expect(arrayBufferToBase64(files.get(collision)!)).toBe("AQID");
    });

    it(`completes both concurrent saves when the winning attachment contains the same bytes (${ISSUE})`, async () => {
      const { app, files, vault } = makeApp();
      let releaseFirst!: () => void;
      let finishFirst!: () => void;
      const secondCreating = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstWritten = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      vault.createBinary.mockImplementation(async (path, bytes) => {
        if (vault.createBinary.mock.calls.length === 1) {
          await secondCreating;
          files.set(path, bytes);
          finishFirst();
          return { path };
        }
        releaseFirst();
        await firstWritten;
        throw new Error("File already exists.");
      });
      const messages = [{ message: "", content: [IMAGE] }];
      const results = await Promise.all([
        prepareChatImagesForSave(app, messages, "chats/one.md"),
        prepareChatImagesForSave(app, messages, "chats/two.md"),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0][0].message).toBe(`![](/attachments/copilot-image-${sha256(DATA)}.png)`);
      expect(files.size).toBe(1);
      expect(arrayBufferToBase64([...files.values()][0])).toBe(DATA);
      expect(vault.createBinary).toHaveBeenCalledTimes(2);
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
          prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], "chats/new.md")
        ).rejects.toBe(collision);
      }
    );

    it(`escapes folder characters that could break an image embed (${ISSUE})`, async () => {
      const { app } = makeApp("images ] # % (reference)");
      const prepared = await prepareChatImagesForSave(
        app,
        [{ message: "", content: [IMAGE] }],
        "chats/new.md"
      );
      expect(prepared[0].message).toBe(
        `![](/images%20%5D%20%23%20%25%20%28reference%29/copilot-image-${sha256(DATA)}.png)`
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
      const prepared = await prepareChatImagesForSave(app, messages, "chats/new.md");
      expect(prepared).toEqual(messages);
      expect(prepared[0]).toBe(messages[0]);
      expect(vault.getAvailablePathForAttachments).not.toHaveBeenCalled();
    });

    it.each([
      "data:image/png;base64,",
      "data:image/png;base64,???",
      "data:image/x-invalid;base64,AQID",
      "data:image/png;base64,A",
    ])(
      `rejects malformed uploaded image %j without writing an attachment (${ISSUE})`,
      async (url) => {
        const { app, vault } = makeApp();
        await expect(
          prepareChatImagesForSave(
            app,
            [{ message: "", content: [{ type: "image_url", image_url: { url } }] }],
            "chats/new.md"
          )
        ).rejects.toThrow("invalid uploaded image");
        expect(vault.createBinary).not.toHaveBeenCalled();
      }
    );

    it(`rejects attachment write failures so the caller cannot save an incomplete transcript (${ISSUE})`, async () => {
      const { app, vault } = makeApp();
      vault.createBinary.mockRejectedValueOnce(new Error("disk full"));
      await expect(
        prepareChatImagesForSave(app, [{ message: "", content: [IMAGE] }], "chats/new.md")
      ).rejects.toThrow("disk full");
    });
  });
});
