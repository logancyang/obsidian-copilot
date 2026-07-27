import type {
  SymposiumModalOptions,
  SymposiumModalResult,
} from "@/components/modals/SymposiumModal";
import { SymposiumClientError } from "@/symposium/SymposiumClient";
import { SymposiumPublisher } from "@/symposium/SymposiumPublisher";
import type { SymposiumDocument, SymposiumReceipt } from "@/symposium/types";
import type { App, TFile } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const NEW_DOC_ID = "0123456789abcdef";
const DOCUMENT: SymposiumDocument = {
  title: "Architecture",
  html: "<!doctype html><html><body>Review</body></html>",
  byteLength: 52,
};
const RECEIPT: SymposiumReceipt = {
  docId: DOC_ID,
  url: `https://symposium.md/d/${DOC_ID}?server=exact`,
  version: 1,
};

interface Harness {
  app: App;
  buildDocument: jest.Mock;
  client: {
    publish: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  file: TFile;
  frontmatter: Record<string, unknown>;
  loadLicenseKey: jest.Mock;
  modalOptions: SymposiumModalOptions[];
  openModal: jest.Mock;
  processFrontMatter: jest.Mock;
  publisher: SymposiumPublisher;
}

function createHarness(frontmatter: Record<string, unknown> = {}): Harness {
  const file = {
    path: "Notes/Architecture.md",
    basename: "Architecture",
  } as TFile; // eslint-disable-line obsidianmd/no-tfile-tfolder-cast -- focused controller test fixture
  const processFrontMatter = jest.fn(
    async (_file: TFile, update: (value: Record<string, unknown>) => void) => {
      update(frontmatter);
    }
  );
  const app = {
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter })),
    },
    fileManager: { processFrontMatter },
  } as unknown as App;
  const client = {
    publish: jest.fn().mockResolvedValue(RECEIPT),
    update: jest.fn().mockResolvedValue({ ...RECEIPT, version: 2 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const loadLicenseKey = jest.fn().mockResolvedValue("decrypted-license");
  const buildDocument = jest.fn().mockResolvedValue(DOCUMENT);
  const modalOptions: SymposiumModalOptions[] = [];
  const openModal = jest.fn();
  const publisher = new SymposiumPublisher(app, {
    client,
    loadLicenseKey,
    buildDocument,
    createModal: (options) => {
      modalOptions.push(options);
      return { open: openModal };
    },
  });

  return {
    app,
    buildDocument,
    client,
    file,
    frontmatter,
    loadLicenseKey,
    modalOptions,
    openModal,
    processFrontMatter,
    publisher,
  };
}

async function openAndConfirm(
  harness: Harness,
  action: "publish" | "update" | "delete"
): Promise<SymposiumModalResult> {
  await harness.publisher.open(harness.file);
  return harness.modalOptions.at(-1)!.onConfirm(action, activeDocument);
}

describe("SymposiumPublisher", () => {
  describe("SymposiumPublisher", () => {
    describe("open()", () => {
      it.each([
        ["missing", {}],
        ["non-string", { symposium: { docId: DOC_ID } }],
        ["malformed", { symposium: "UPPERCASE1234567" }],
      ])("opens an unpublished confirmation and posts for a %s property", async (_case, value) => {
        const harness = createHarness(value);

        await harness.publisher.open(harness.file);

        expect(harness.openModal).toHaveBeenCalledTimes(1);
        expect(harness.modalOptions[0]).toMatchObject({
          fileName: "Architecture",
          docId: null,
        });

        const result = await harness.modalOptions[0].onConfirm("publish", activeDocument);

        expect(result).toEqual({ kind: "success", action: "publish", receipt: RECEIPT });
        expect(harness.loadLicenseKey).toHaveBeenCalledTimes(1);
        expect(harness.buildDocument).toHaveBeenCalledWith(harness.file, activeDocument);
        expect(harness.client.publish).toHaveBeenCalledWith(DOCUMENT, "decrypted-license");
        expect(harness.frontmatter.symposium).toBe(DOC_ID);
      });

      it("updates the current valid id without rewriting frontmatter", async () => {
        const harness = createHarness({ symposium: DOC_ID });

        const result = await openAndConfirm(harness, "update");

        expect(harness.modalOptions[0].docId).toBe(DOC_ID);
        expect(result).toEqual({
          kind: "success",
          action: "update",
          receipt: { ...RECEIPT, version: 2 },
        });
        expect(harness.client.update).toHaveBeenCalledWith(DOC_ID, DOCUMENT, "decrypted-license");
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.processFrontMatter).not.toHaveBeenCalled();
      });

      it("lets copied notes intentionally update the same remote id", async () => {
        const first = createHarness({ symposium: DOC_ID });
        const second = createHarness({ symposium: DOC_ID });

        await openAndConfirm(first, "update");
        await openAndConfirm(second, "update");

        expect(first.client.update).toHaveBeenCalledWith(DOC_ID, DOCUMENT, "decrypted-license");
        expect(second.client.update).toHaveBeenCalledWith(DOC_ID, DOCUMENT, "decrypted-license");
      });

      it("falls back once from exact PUT not_found to POST and replaces the stale id", async () => {
        const replacement = { ...RECEIPT, docId: NEW_DOC_ID, version: 1 };
        const harness = createHarness({ symposium: DOC_ID });
        harness.client.update.mockRejectedValue(
          new SymposiumClientError("Document is gone.", "not_found", 404, false)
        );
        harness.client.publish.mockResolvedValue(replacement);

        const result = await openAndConfirm(harness, "update");

        expect(result).toEqual({ kind: "success", action: "publish", receipt: replacement });
        expect(harness.client.update).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
        expect(harness.frontmatter.symposium).toBe(NEW_DOC_ID);
      });

      it("does not POST after any update failure other than structured 404 not_found", async () => {
        const harness = createHarness({ symposium: DOC_ID });
        harness.client.update.mockRejectedValue(
          new SymposiumClientError(
            "Publishing is currently limited to lifetime license holders.",
            "unauthorized",
            401,
            false
          )
        );

        const result = await openAndConfirm(harness, "update");

        expect(result).toEqual({
          kind: "failure",
          action: "update",
          message: "Publishing is currently limited to lifetime license holders.",
          accessNotice: true,
          retryable: false,
        });
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("keeps structured internal server failures retryable", async () => {
        const harness = createHarness();
        harness.client.publish.mockRejectedValue(
          new SymposiumClientError(
            "License validation is temporarily unavailable.",
            "internal",
            500,
            true
          )
        );

        const result = await openAndConfirm(harness, "publish");

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message: "License validation is temporarily unavailable.",
          accessNotice: false,
          retryable: true,
        });
      });

      it("preserves a successful POST receipt and retries only the local save", async () => {
        const harness = createHarness();
        harness.processFrontMatter
          .mockRejectedValueOnce(new Error("vault is read-only"))
          .mockImplementationOnce(
            async (_file: TFile, update: (value: Record<string, unknown>) => void) => {
              update(harness.frontmatter);
            }
          );

        const partial = await openAndConfirm(harness, "publish");

        expect(partial).toMatchObject({
          kind: "persistence",
          action: "publish",
          receipt: RECEIPT,
        });
        expect(harness.client.publish).toHaveBeenCalledTimes(1);

        const saved = await (
          partial as Extract<SymposiumModalResult, { kind: "persistence" }>
        ).retrySave();

        expect(saved).toEqual({ kind: "success", action: "publish", receipt: RECEIPT });
        expect(harness.frontmatter.symposium).toBe(DOC_ID);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
      });

      it("rejects a stale unpublished confirmation before it can orphan another page", async () => {
        const harness = createHarness();
        await harness.publisher.open(harness.file);
        await harness.publisher.open(harness.file);

        await harness.modalOptions[0].onConfirm("publish", activeDocument);
        const stale = await harness.modalOptions[1].onConfirm("publish", activeDocument);

        expect(stale).toEqual({
          kind: "failure",
          action: "publish",
          message:
            "This note's Symposium identity changed. Close and reopen this dialog before trying again.",
          accessNotice: false,
          retryable: false,
        });
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
      });

      it("deletes remotely before clearing identity and retries a failed local removal only", async () => {
        const harness = createHarness({ symposium: DOC_ID, tags: ["shared"] });
        harness.processFrontMatter
          .mockRejectedValueOnce(new Error("vault is read-only"))
          .mockImplementationOnce(
            async (_file: TFile, update: (value: Record<string, unknown>) => void) => {
              update(harness.frontmatter);
            }
          );

        const partial = await openAndConfirm(harness, "delete");

        expect(harness.client.delete).toHaveBeenCalledWith(DOC_ID, "decrypted-license");
        expect(harness.buildDocument).not.toHaveBeenCalled();
        expect(partial).toMatchObject({ kind: "persistence", action: "delete" });

        const removed = await (
          partial as Extract<SymposiumModalResult, { kind: "persistence" }>
        ).retrySave();

        expect(removed).toEqual({ kind: "success", action: "delete" });
        expect(harness.frontmatter).toEqual({ tags: ["shared"] });
        expect(harness.client.delete).toHaveBeenCalledTimes(1);
      });

      it("requires a decryptable configured key without locally checking a plan", async () => {
        const harness = createHarness();
        harness.loadLicenseKey.mockResolvedValue("");

        const result = await openAndConfirm(harness, "publish");

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message: "Add a Copilot Plus license key in Settings before publishing with Symposium.",
          accessNotice: true,
          retryable: false,
        });
        expect(harness.buildDocument).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("keeps one in-flight operation per file across renames and releases it afterward", async () => {
        const harness = createHarness();
        let resolvePublish: ((receipt: SymposiumReceipt) => void) | undefined;
        harness.client.publish.mockImplementationOnce(
          () =>
            new Promise<SymposiumReceipt>((resolve) => {
              resolvePublish = resolve;
            })
        );
        await harness.publisher.open(harness.file);
        await harness.publisher.open(harness.file);

        const first = harness.modalOptions[0].onConfirm("publish", activeDocument);
        await Promise.resolve();
        harness.file.path = "Notes/Renamed Architecture.md";
        const second = await harness.modalOptions[1].onConfirm("publish", activeDocument);

        expect(second).toEqual({
          kind: "failure",
          action: "publish",
          message: "A Symposium action is already in progress for this note.",
          accessNotice: false,
          retryable: false,
        });

        resolvePublish?.(RECEIPT);
        await expect(first).resolves.toEqual({
          kind: "success",
          action: "publish",
          receipt: RECEIPT,
        });
        expect(harness.client.publish).toHaveBeenCalledTimes(1);

        const third = await openAndConfirm(harness, "update");
        expect(third).toEqual({
          kind: "success",
          action: "update",
          receipt: { ...RECEIPT, version: 2 },
        });
        expect(harness.client.update).toHaveBeenCalledTimes(1);
      });
    });
  });
});
