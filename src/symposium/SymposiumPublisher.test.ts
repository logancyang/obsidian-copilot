import type {
  SymposiumModalOptions,
  SymposiumModalResult,
} from "@/components/modals/SymposiumModal";
import { SymposiumClientError } from "@/symposium/SymposiumClient";
import { SymposiumPublisher } from "@/symposium/SymposiumPublisher";
import { SymposiumDocumentTooLargeError } from "@/symposium/symposiumDocument";
import type { SymposiumLedgerEntry } from "@/symposium/symposiumLedger";
import type { SymposiumDocument, SymposiumReceipt } from "@/symposium/types";
import { sha256 } from "@/utils/hash";
import type { App, TFile } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const NEW_DOC_ID = "0123456789abcdef";
const DOC_URL = `https://symposium.md/d/${DOC_ID}?server=exact`;
const NEW_DOC_URL = `https://symposium.md/d/${NEW_DOC_ID}?server=exact`;
const DOCUMENT: SymposiumDocument = {
  title: "Architecture",
  html: "<!doctype html><html><body>Review</body></html>",
  byteLength: 52,
};
const RECEIPT: SymposiumReceipt = {
  docId: DOC_ID,
  url: DOC_URL,
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
  closeModal: jest.Mock;
  openModal: jest.Mock;
  processFrontMatter: jest.Mock;
  publisher: SymposiumPublisher;
  recordLedger: jest.Mock<Promise<void>, [SymposiumLedgerEntry]>;
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
    vault: {
      read: jest.fn(async () => {
        const yaml = Object.entries(frontmatter)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join("\n");
        return yaml ? `---\n${yaml}\n---\n` : "";
      }),
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
  const closeModal = jest.fn();
  const recordLedger = jest
    .fn<Promise<void>, [SymposiumLedgerEntry]>()
    .mockResolvedValue(undefined);
  const publisher = new SymposiumPublisher(app, {
    client,
    loadLicenseKey,
    buildDocument,
    recordLedger,
    createModal: (options) => {
      modalOptions.push(options);
      return { open: openModal, close: closeModal };
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
    closeModal,
    openModal,
    processFrontMatter,
    publisher,
    recordLedger,
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
      it("opens an unpublished confirmation and posts when the property is missing", async () => {
        const value = {};
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
        const ledgerEntry = harness.recordLedger.mock.calls[0][0];
        expect(ledgerEntry).toMatchObject({
          docId: DOC_ID,
          status: "published",
          notePath: "Notes/Architecture.md",
          url: RECEIPT.url,
          version: 1,
          contentHash: sha256(DOCUMENT.html),
        });
        expect(ledgerEntry.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(harness.recordLedger.mock.invocationCallOrder[0]).toBeLessThan(
          harness.processFrontMatter.mock.invocationCallOrder[0]
        );
        expect(harness.frontmatter.symposium).toBe(DOC_URL);
      });

      it("keeps a successful publish usable when the advisory ledger cannot be written", async () => {
        const harness = createHarness();
        harness.recordLedger.mockRejectedValue(new Error("vault is read-only"));

        const result = await openAndConfirm(harness, "publish");

        expect(result).toEqual({ kind: "success", action: "publish", receipt: RECEIPT });
        expect(harness.recordLedger).toHaveBeenCalledTimes(1);
        expect(harness.frontmatter.symposium).toBe(DOC_URL);
      });

      it.each([
        ["non-string", { docId: DOC_ID }],
        ["malformed", "UPPERCASE1234567"],
      ])("refuses to overwrite an occupied %s property", async (_case, value) => {
        const harness = createHarness({ symposium: value });

        const result = await openAndConfirm(harness, "publish");

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message:
            "This note already uses the symposium property for an unrecognized value. Recover its public link from copilot/symposium/published-documents.md, then repair or remove the property before publishing.",
          accessNotice: false,
          retryable: false,
        });
        expect(harness.frontmatter.symposium).toBe(value);
        expect(harness.buildDocument).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it.each([
        ["malformed YAML", "---\nsymposium: [\n---\n"],
        ["a YAML sequence", "---\n- shared\n---\n"],
      ])("rejects %s before rendering or publishing", async (_case, markdown) => {
        const harness = createHarness();
        jest.mocked(harness.app.vault.read).mockResolvedValue(markdown);

        await harness.publisher.open(harness.file);
        const result = harness.modalOptions[0].initialResult;

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message:
            "This note's frontmatter must be a YAML property map. Fix it before publishing to Symposium.",
          accessNotice: false,
          retryable: false,
        });
        await expect(harness.modalOptions[0].onConfirm("publish", activeDocument)).resolves.toEqual(
          result
        );
        expect(harness.buildDocument).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("updates the current valid id without rewriting frontmatter", async () => {
        const harness = createHarness({ symposium: DOC_URL });

        const result = await openAndConfirm(harness, "update");

        expect(harness.modalOptions[0].docId).toBe(DOC_ID);
        expect(result).toEqual({
          kind: "success",
          action: "update",
          receipt: { ...RECEIPT, version: 2 },
        });
        expect(harness.client.update).toHaveBeenCalledWith(DOC_ID, DOCUMENT, "decrypted-license");
        expect(harness.recordLedger).toHaveBeenCalledWith(
          expect.objectContaining({
            docId: DOC_ID,
            status: "published",
            version: 2,
          })
        );
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.processFrontMatter).not.toHaveBeenCalled();
      });

      it("lets copied notes intentionally update the same remote id", async () => {
        const first = createHarness({ symposium: DOC_URL });
        const second = createHarness({ symposium: DOC_URL });

        await openAndConfirm(first, "update");
        await openAndConfirm(second, "update");

        expect(first.client.update).toHaveBeenCalledWith(DOC_ID, DOCUMENT, "decrypted-license");
        expect(second.client.update).toHaveBeenCalledWith(DOC_ID, DOCUMENT, "decrypted-license");
      });

      it("reports partial success without replacing a newer identity after update completes", async () => {
        const receipt = { ...RECEIPT, version: 2 };
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockImplementation(async () => {
          harness.frontmatter.symposium = NEW_DOC_URL;
          return receipt;
        });

        const result = await openAndConfirm(harness, "update");

        expect(result).toEqual({
          kind: "persistence",
          action: "update",
          message:
            "The original page was updated, but this note’s Symposium identity changed or could not be verified. Its current identity was left unchanged.",
          receipt,
        });
        expect(harness.frontmatter.symposium).toBe(NEW_DOC_URL);
        expect(harness.processFrontMatter).not.toHaveBeenCalled();

        await harness.publisher.open(harness.file);
        expect(harness.modalOptions[1]).toMatchObject({
          docId: NEW_DOC_ID,
          initialResult: undefined,
        });
      });

      it("reports partial success when the identity cannot be read after update completes", async () => {
        const receipt = { ...RECEIPT, version: 2 };
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockImplementation(async () => {
          (harness.app.vault.read as jest.Mock).mockRejectedValueOnce(
            new Error("vault unavailable")
          );
          return receipt;
        });

        const result = await openAndConfirm(harness, "update");

        expect(result).toEqual({
          kind: "persistence",
          action: "update",
          message:
            "The original page was updated, but this note’s Symposium identity changed or could not be verified. Its current identity was left unchanged.",
          receipt,
        });
        expect(harness.frontmatter.symposium).toBe(DOC_URL);
        expect(harness.processFrontMatter).not.toHaveBeenCalled();

        await harness.publisher.open(harness.file);
        expect(harness.modalOptions[1].initialResult).toEqual(result);
      });

      it("retains an updated receipt when the note identity disappears", async () => {
        const receipt = { ...RECEIPT, version: 2 };
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockImplementation(async () => {
          delete harness.frontmatter.symposium;
          return receipt;
        });

        const result = await openAndConfirm(harness, "update");

        expect(result).toEqual({
          kind: "persistence",
          action: "update",
          message:
            "The original page was updated, but this note’s Symposium identity changed or could not be verified. Its current identity was left unchanged.",
          receipt,
        });

        harness.modalOptions[0].onClosed?.();
        await harness.publisher.open(harness.file);

        expect(harness.modalOptions[1].initialResult).toEqual(result);
        await expect(harness.modalOptions[1].onConfirm("publish", activeDocument)).resolves.toEqual(
          result
        );
        expect(harness.client.update).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("falls back once from exact PUT not_found to POST and replaces the stale id", async () => {
        const replacement = { ...RECEIPT, docId: NEW_DOC_ID, url: NEW_DOC_URL, version: 1 };
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockRejectedValue(
          new SymposiumClientError("Document is gone.", "not_found", 404, false)
        );
        harness.client.publish.mockResolvedValue(replacement);

        const result = await openAndConfirm(harness, "update");

        expect(result).toEqual({ kind: "success", action: "publish", receipt: replacement });
        expect(harness.client.update).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
        expect(harness.frontmatter.symposium).toBe(NEW_DOC_URL);
      });

      it("retains a fallback POST receipt when the stale identity disappears", async () => {
        const replacement = { ...RECEIPT, docId: NEW_DOC_ID, url: NEW_DOC_URL, version: 1 };
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockRejectedValue(
          new SymposiumClientError("Document is gone.", "not_found", 404, false)
        );
        harness.client.publish.mockImplementation(async () => {
          delete harness.frontmatter.symposium;
          return replacement;
        });

        const result = await openAndConfirm(harness, "update");

        expect(result).toMatchObject({
          kind: "persistence",
          action: "publish",
          receipt: replacement,
        });
        expect(
          (result as Extract<SymposiumModalResult, { kind: "persistence" }>).retrySave
        ).toBeUndefined();

        harness.modalOptions[0].onClosed?.();
        await harness.publisher.open(harness.file);

        expect(harness.modalOptions[1].initialResult).toEqual(result);
        await expect(harness.modalOptions[1].onConfirm("publish", activeDocument)).resolves.toEqual(
          result
        );
        expect(harness.client.update).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
      });

      it("does not POST a fallback when the identity changes during the failed update", async () => {
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockImplementation(async () => {
          harness.frontmatter.symposium = NEW_DOC_URL;
          throw new SymposiumClientError("Document is gone.", "not_found", 404, false);
        });

        const result = await openAndConfirm(harness, "update");

        expect(result).toMatchObject({
          kind: "failure",
          action: "update",
          retryable: false,
        });
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.frontmatter.symposium).toBe(NEW_DOC_URL);
      });

      it("does not POST after any update failure other than structured 404 not_found", async () => {
        const harness = createHarness({ symposium: DOC_URL });
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

      it("blocks another POST after a publish response is lost", async () => {
        const message =
          "Symposium may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.";
        const harness = createHarness();
        harness.client.publish.mockRejectedValue(
          new SymposiumClientError(message, "ambiguous_publish", null, false)
        );
        await harness.publisher.open(harness.file);
        await harness.publisher.open(harness.file);

        const first = await harness.modalOptions[0].onConfirm("publish", activeDocument);

        expect(first).toEqual({
          kind: "failure",
          action: "publish",
          message,
          accessNotice: false,
          retryable: false,
        });
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
        await expect(harness.modalOptions[1].onConfirm("publish", activeDocument)).resolves.toEqual(
          first
        );
        expect(harness.client.publish).toHaveBeenCalledTimes(1);

        harness.modalOptions[0].onClosed?.();
        harness.modalOptions[1].onClosed?.();
        await harness.publisher.open(harness.file);

        expect(harness.modalOptions[2].initialResult).toEqual(first);
        await expect(harness.modalOptions[2].onConfirm("publish", activeDocument)).resolves.toEqual(
          first
        );
        expect(harness.buildDocument).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
      });

      it("reports an oversized rendered document without offering a futile retry", async () => {
        const harness = createHarness();
        harness.buildDocument.mockRejectedValue(
          new SymposiumDocumentTooLargeError(10 * 1024 * 1024 + 1)
        );

        const result = await openAndConfirm(harness, "publish");

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message: "Symposium HTML is 10485761 bytes; the limit is 10485760 bytes.",
          accessNotice: false,
          retryable: false,
        });
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("keeps a frontmatter read failure retryable without sending a request", async () => {
        const harness = createHarness();
        await harness.publisher.open(harness.file);
        (harness.app.vault.read as jest.Mock).mockRejectedValueOnce(new Error("vault unavailable"));

        const result = await harness.modalOptions[0].onConfirm("publish", activeDocument);

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message: "Copilot could not complete this Symposium action.",
          accessNotice: false,
          retryable: true,
        });
        expect(harness.client.publish).not.toHaveBeenCalled();
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

        harness.modalOptions[0].onClosed?.();
        await harness.publisher.open(harness.file);

        const resumed = harness.modalOptions[1].initialResult;
        expect(resumed).toMatchObject({
          kind: "persistence",
          action: "publish",
          receipt: RECEIPT,
        });
        expect(harness.buildDocument).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);

        const saved = await (resumed as Extract<SymposiumModalResult, { kind: "persistence" }>)
          .retrySave!();

        expect(saved).toEqual({ kind: "success", action: "publish", receipt: RECEIPT });
        expect(harness.frontmatter.symposium).toBe(DOC_URL);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);

        harness.modalOptions[1].onClosed?.();
        await harness.publisher.open(harness.file);
        expect(harness.modalOptions[2]).toMatchObject({ docId: DOC_ID });
        expect(harness.modalOptions[2].initialResult).toBeUndefined();
      });

      it("retains a successful POST receipt when frontmatter becomes a sequence", async () => {
        const harness = createHarness();
        harness.processFrontMatter.mockImplementationOnce(
          async (_file: TFile, update: (value: Record<string, unknown>) => void) => {
            update(["shared"] as unknown as Record<string, unknown>);
          }
        );

        const result = await openAndConfirm(harness, "publish");

        expect(result).toMatchObject({
          kind: "persistence",
          action: "publish",
          receipt: RECEIPT,
        });
        expect(
          (result as Extract<SymposiumModalResult, { kind: "persistence" }>).retrySave
        ).toBeInstanceOf(Function);

        harness.modalOptions[0].onClosed?.();
        await harness.publisher.open(harness.file);

        expect(harness.modalOptions[1].initialResult).toEqual(result);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["newer identity", NEW_DOC_ID],
        ["unrecognized property", { url: "https://example.com/symposium" }],
      ])("does not overwrite a %s after a publish completes", async (_case, newerValue) => {
        const harness = createHarness();
        harness.client.publish.mockImplementation(async () => {
          harness.frontmatter.symposium = newerValue;
          return RECEIPT;
        });

        const result = await openAndConfirm(harness, "publish");

        expect(result).toMatchObject({
          kind: "persistence",
          action: "publish",
          receipt: RECEIPT,
        });
        expect(
          (result as Extract<SymposiumModalResult, { kind: "persistence" }>).retrySave
        ).toBeUndefined();
        expect(harness.frontmatter.symposium).toBe(newerValue);
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

      it("does not publish when the identity changes while the document is rendering", async () => {
        const harness = createHarness();
        harness.buildDocument.mockImplementation(async () => {
          harness.frontmatter.symposium = NEW_DOC_URL;
          return DOCUMENT;
        });

        const result = await openAndConfirm(harness, "publish");

        expect(result).toMatchObject({
          kind: "failure",
          action: "publish",
          retryable: false,
        });
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.frontmatter.symposium).toBe(NEW_DOC_URL);
      });

      it("deletes remotely before clearing identity and retries a failed local removal only", async () => {
        const harness = createHarness({ symposium: DOC_URL, tags: ["shared"] });
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
        expect(harness.recordLedger).toHaveBeenCalledWith({
          docId: DOC_ID,
          status: "unpublished",
          notePath: "Notes/Architecture.md",
          url: null,
          publishedAt: null,
          version: null,
          contentHash: null,
        });
        expect(harness.recordLedger.mock.invocationCallOrder[0]).toBeLessThan(
          harness.processFrontMatter.mock.invocationCallOrder[0]
        );
        expect(partial).toMatchObject({ kind: "persistence", action: "delete" });

        harness.modalOptions[0].onClosed?.();
        await harness.publisher.open(harness.file);

        const resumed = harness.modalOptions[1].initialResult;
        expect(resumed).toMatchObject({ kind: "persistence", action: "delete" });
        expect(harness.client.update).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();

        const removed = await (resumed as Extract<SymposiumModalResult, { kind: "persistence" }>)
          .retrySave!();

        expect(removed).toEqual({ kind: "success", action: "delete" });
        expect(harness.frontmatter).toEqual({ tags: ["shared"] });
        expect(harness.client.delete).toHaveBeenCalledTimes(1);

        harness.modalOptions[1].onClosed?.();
        await harness.publisher.open(harness.file);
        expect(harness.modalOptions[2]).toMatchObject({ docId: null });
        expect(harness.modalOptions[2].initialResult).toBeUndefined();
      });

      it("does not remove a newer identity after a remote deletion completes", async () => {
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.delete.mockImplementation(async () => {
          harness.frontmatter.symposium = NEW_DOC_URL;
        });

        const result = await openAndConfirm(harness, "delete");

        expect(result).toMatchObject({ kind: "persistence", action: "delete" });
        expect(
          (result as Extract<SymposiumModalResult, { kind: "persistence" }>).retrySave
        ).toBeUndefined();
        expect(harness.frontmatter.symposium).toBe(NEW_DOC_URL);
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
        for (let turn = 0; turn < 20 && !resolvePublish; turn += 1) {
          await Promise.resolve();
        }
        expect(resolvePublish).toBeDefined();
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

      it("disposes open modals and prevents stale callbacks after plugin teardown", async () => {
        const harness = createHarness();
        await harness.publisher.open(harness.file);

        harness.publisher.dispose();
        const result = await harness.modalOptions[0].onConfirm("publish", activeDocument);
        await harness.publisher.open(harness.file);

        expect(harness.closeModal).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message: "Symposium publishing is no longer available.",
          accessNotice: false,
          retryable: false,
        });
        expect(harness.openModal).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("does not open a modal when plugin teardown occurs during the identity read", async () => {
        const harness = createHarness();
        let resolveRead: ((markdown: string) => void) | undefined;
        jest.mocked(harness.app.vault.read).mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveRead = resolve;
            })
        );

        const opening = harness.publisher.open(harness.file);
        harness.publisher.dispose();
        resolveRead?.("");
        await opening;

        expect(harness.openModal).not.toHaveBeenCalled();
        expect(harness.modalOptions).toHaveLength(0);
      });
    });
  });
});
