import type {
  OpenArtifactsModalOptions,
  OpenArtifactsModalResult,
} from "@/components/modals/OpenArtifactsModal";
import { OpenArtifactsClientError } from "@/openArtifacts/OpenArtifactsClient";
import {
  createOpenArtifactsAgentBridge,
  OpenArtifactsPublisher,
} from "@/openArtifacts/OpenArtifactsPublisher";
import { OPENARTIFACTS_MAX_HTML_BYTES } from "@/openArtifacts/openArtifactsDocument";
import type { OpenArtifactsLedgerEntry } from "@/openArtifacts/openArtifactsLedger";
import type { OpenArtifactsAgentHandoff } from "@/openArtifacts/openArtifactsAgentHandoff";
import type { OpenArtifactsDocument, OpenArtifactsReceipt } from "@/openArtifacts/types";
import { sha256 } from "@/utils/hash";
import { TFile, type App } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const NEW_DOC_ID = "0123456789abcdef";
const DOC_URL = `https://openartifacts.site/d/${DOC_ID}?server=exact`;
const NEW_DOC_URL = `https://openartifacts.site/d/${NEW_DOC_ID}?server=exact`;
const DOCUMENT: OpenArtifactsDocument = {
  title: "Architecture",
  html: "<!doctype html><html><body>Review</body></html>",
  byteLength: 52,
};
const RECEIPT: OpenArtifactsReceipt = {
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
  modalOptions: OpenArtifactsModalOptions[];
  closeModal: jest.Mock;
  openModal: jest.Mock;
  processFrontMatter: jest.Mock;
  previewIsCurrent: jest.Mock;
  publisher: OpenArtifactsPublisher;
  readStagedHtml: jest.Mock;
  recordLedger: jest.Mock<Promise<void>, [OpenArtifactsLedgerEntry]>;
  removePreview: jest.Mock;
}

function createHarness(frontmatter: Record<string, unknown> = {}): Harness {
  const MockTFile = TFile as unknown as new (path: string) => TFile;
  const file = new MockTFile("Notes/Architecture.md");
  const processFrontMatter = jest.fn(
    async (_file: TFile, update: (value: Record<string, unknown>) => void) => {
      update(frontmatter);
    }
  );
  const readStagedHtml = jest.fn().mockResolvedValue(DOCUMENT.html);
  const previewIsCurrent = jest.fn().mockResolvedValue(true);
  const removePreview = jest.fn().mockResolvedValue(undefined);
  const consumeAgentHandoff = jest.fn(
    async (stagedHtmlPath: string): Promise<OpenArtifactsAgentHandoff> => {
      const html = (await readStagedHtml(stagedHtmlPath)) as string;
      const fileName = stagedHtmlPath.split("/").at(-1);
      const previewPath = `/tmp/${fileName}`;
      return {
        html,
        previewPath,
        previewUrl: `file://${previewPath}`,
        isPreviewCurrent: previewIsCurrent,
        cleanup: removePreview,
      };
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
      getAbstractFileByPath: jest.fn((path: string) => (path === file.path ? file : null)),
      adapter: {},
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
  const modalOptions: OpenArtifactsModalOptions[] = [];
  const openModal = jest.fn();
  const closeModal = jest.fn();
  const recordLedger = jest
    .fn<Promise<void>, [OpenArtifactsLedgerEntry]>()
    .mockResolvedValue(undefined);
  const publisher = new OpenArtifactsPublisher(app, {
    client,
    loadLicenseKey,
    buildDocument,
    consumeAgentHandoff,
    recordLedger,
    createModal: (options) => {
      modalOptions.push(options);
      return {
        open: openModal,
        close: () => {
          closeModal();
          options.onClosed?.();
        },
      };
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
    previewIsCurrent,
    processFrontMatter,
    publisher,
    readStagedHtml,
    recordLedger,
    removePreview,
  };
}

async function reviewAndConfirm(
  harness: Harness,
  action: "publish" | "update" | "delete"
): Promise<OpenArtifactsModalResult> {
  const { options } = await startAgentReview(harness);
  return options.onConfirm(action, activeDocument);
}

async function startAgentReview(
  harness: Harness,
  html = DOCUMENT.html,
  stagedPath = ".openartifacts/handoffs/review.html"
): Promise<{
  outcome: Promise<Awaited<ReturnType<OpenArtifactsPublisher["reviewAgentPublish"]>>>;
  options: OpenArtifactsModalOptions;
}> {
  const initialModalCount = harness.modalOptions.length;
  harness.readStagedHtml.mockResolvedValueOnce(html);
  const outcome = harness.publisher.reviewAgentPublish(harness.file.path, stagedPath);
  for (let turn = 0; turn < 20 && harness.modalOptions.length === initialModalCount; turn += 1) {
    await Promise.resolve();
  }
  const options = harness.modalOptions.at(-1);
  if (!options) throw new Error("Expected agent review modal");
  return { outcome, options };
}

async function startAgentManage(harness: Harness): Promise<{
  outcome: Promise<Awaited<ReturnType<OpenArtifactsPublisher["reviewAgentManage"]>>>;
  options: OpenArtifactsModalOptions;
}> {
  const outcome = harness.publisher.reviewAgentManage(harness.file.path);
  for (let turn = 0; turn < 20 && harness.modalOptions.length === 0; turn += 1) {
    await Promise.resolve();
  }
  const options = harness.modalOptions.at(-1);
  if (!options) throw new Error("Expected agent management modal");
  return { outcome, options };
}

describe("OpenArtifactsPublisher", () => {
  describe("createOpenArtifactsAgentBridge()", () => {
    it("exposes frozen path-only operations that delegate to the trusted publisher", async () => {
      const harness = createHarness();
      const manage = jest
        .spyOn(harness.publisher, "reviewAgentManage")
        .mockResolvedValue({ status: "cancelled" });
      const review = jest
        .spyOn(harness.publisher, "reviewAgentPublish")
        .mockResolvedValue({ status: "cancelled" });

      const bridge = createOpenArtifactsAgentBridge(harness.publisher);

      expect(Object.isFrozen(bridge)).toBe(true);
      expect(Object.keys(bridge)).toEqual(["reviewAgentManage", "reviewAgentPublish"]);
      await expect(bridge.reviewAgentManage("Notes/Architecture.md")).resolves.toEqual({
        status: "cancelled",
      });
      expect(manage).toHaveBeenCalledWith("Notes/Architecture.md");
      await expect(
        bridge.reviewAgentPublish("Notes/Architecture.md", ".openartifacts/handoffs/review.html")
      ).resolves.toEqual({ status: "cancelled" });
      expect(review).toHaveBeenCalledWith(
        "Notes/Architecture.md",
        ".openartifacts/handoffs/review.html"
      );
    });
  });

  describe("OpenArtifactsPublisher", () => {
    describe("reviewAgentManage()", () => {
      it("opens host management and deletes only after the user chooses Delete", async () => {
        const harness = createHarness({ symposium: DOC_URL, tags: ["shared"] });
        const { outcome, options } = await startAgentManage(harness);

        expect(options).toMatchObject({
          fileName: "Architecture",
          docId: DOC_ID,
        });
        expect(options.review).toBeUndefined();
        expect(harness.client.delete).not.toHaveBeenCalled();

        const result = await options.onConfirm("delete", activeDocument);

        expect(result).toEqual({ kind: "success", action: "delete" });
        await expect(outcome).resolves.toEqual({ status: "deleted" });
        expect(harness.client.delete).toHaveBeenCalledWith(DOC_ID, "decrypted-license");
        expect(harness.buildDocument).not.toHaveBeenCalled();
        expect(harness.frontmatter).toEqual({ tags: ["shared"] });
        expect(harness.recordLedger).toHaveBeenCalledWith({
          docId: DOC_ID,
          status: "unpublished",
          notePath: harness.file.path,
          url: null,
          publishedAt: null,
          version: null,
          contentHash: null,
        });
      });

      it("cancels without sending a request and rejects notes without a manageable identity", async () => {
        const published = createHarness({ symposium: DOC_URL });
        const management = await startAgentManage(published);

        management.options.onClosed?.();

        await expect(management.outcome).resolves.toEqual({ status: "cancelled" });
        expect(published.client.publish).not.toHaveBeenCalled();
        expect(published.client.update).not.toHaveBeenCalled();
        expect(published.client.delete).not.toHaveBeenCalled();

        const unpublished = createHarness();
        await expect(
          unpublished.publisher.reviewAgentManage(unpublished.file.path)
        ).resolves.toEqual({
          status: "failed",
          message: "This note does not have a valid OpenArtifacts link to manage.",
        });
        await expect(
          unpublished.publisher.reviewAgentManage("../outside.md")
        ).resolves.toMatchObject({
          status: "failed",
        });
        expect(unpublished.openModal).not.toHaveBeenCalled();
      });
    });

    describe("reviewAgentPublish()", () => {
      it("reads exact staged bytes before review and cancellation sends no request", async () => {
        const harness = createHarness();
        const html = "<!doctype html><html><body>Exact bytes</body></html>\n";
        const { outcome, options } = await startAgentReview(harness, html);

        expect(harness.readStagedHtml).toHaveBeenCalledTimes(1);
        expect(harness.readStagedHtml).toHaveBeenCalledWith(".openartifacts/handoffs/review.html");
        expect(harness.readStagedHtml.mock.invocationCallOrder[0]).toBeLessThan(
          harness.openModal.mock.invocationCallOrder[0]
        );
        expect(options.review).toMatchObject({
          sourcePath: harness.file.path,
          digest: sha256(html),
          previewPath: "/tmp/review.html",
          previewUrl: "file:///tmp/review.html",
          payload: {
            title: "Architecture",
            html,
            byteLength: new TextEncoder().encode(html).byteLength,
          },
        });
        expect(Object.isFrozen(options.review)).toBe(true);
        expect(Object.isFrozen(options.review!.payload)).toBe(true);

        options.onClosed?.();

        await expect(outcome).resolves.toEqual({ status: "cancelled" });
        expect(harness.removePreview).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
        expect(harness.client.delete).not.toHaveBeenCalled();
      });

      it("requires regenerated bytes to receive a fresh review and confirmation", async () => {
        const harness = createHarness();
        const firstHtml = "<!doctype html><html><body>First</body></html>";
        const secondHtml = "<!doctype html><html><body>Regenerated</body></html>\n";
        const first = await startAgentReview(
          harness,
          firstHtml,
          ".openartifacts/handoffs/first.html"
        );

        first.options.onRegenerate?.();
        first.options.onClosed?.();

        await expect(first.outcome).resolves.toEqual({ status: "regenerate" });
        expect(harness.removePreview).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).not.toHaveBeenCalled();

        const second = await startAgentReview(
          harness,
          secondHtml,
          ".openartifacts/handoffs/second.html"
        );
        const result = await second.options.onConfirm("delete", activeDocument);

        expect(result).toEqual({ kind: "success", action: "publish", receipt: RECEIPT });
        await expect(second.outcome).resolves.toEqual({
          status: "published",
          url: RECEIPT.url,
        });
        expect(harness.removePreview).toHaveBeenCalledTimes(2);
        second.options.onClosed?.();
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            html: secondHtml,
            byteLength: new TextEncoder().encode(secondHtml).byteLength,
          }),
          "decrypted-license"
        );
        expect(harness.client.update).not.toHaveBeenCalled();
        expect(harness.client.delete).not.toHaveBeenCalled();
      });

      it("uses the freshly read valid identity for PUT and makes POST unreachable", async () => {
        const harness = createHarness({ symposium: DOC_URL });
        const review = await startAgentReview(harness);

        const result = await review.options.onConfirm("publish", activeDocument);

        expect(result).toEqual({
          kind: "success",
          action: "update",
          receipt: { ...RECEIPT, version: 2 },
        });
        await expect(review.outcome).resolves.toEqual({
          status: "updated",
          url: RECEIPT.url,
        });
        review.options.onClosed?.();
        expect(harness.client.update).toHaveBeenCalledWith(
          DOC_ID,
          expect.objectContaining({ html: DOCUMENT.html }),
          "decrypted-license"
        );
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.frontmatter.symposium).toBe(DOC_URL);
        expect(harness.previewIsCurrent).toHaveBeenCalledTimes(1);
      });

      it("rejects confirmation when the local browser preview no longer matches", async () => {
        const harness = createHarness();
        harness.previewIsCurrent.mockResolvedValue(false);
        const review = await startAgentReview(harness);

        const result = await review.options.onConfirm("publish", activeDocument);

        expect(result).toEqual({
          kind: "failure",
          action: "publish",
          message:
            "The local HTML preview changed. Ask the agent to regenerate it before publishing.",
          accessNotice: false,
          retryable: false,
        });
        await expect(review.outcome).resolves.toEqual({
          status: "failed",
          message:
            "The local HTML preview changed. Ask the agent to regenerate it before publishing.",
        });
        expect(harness.previewIsCurrent).toHaveBeenCalledTimes(1);
        expect(harness.removePreview).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
      });

      it("preserves a valid identity and sends zero POSTs when the agent PUT returns 404", async () => {
        const harness = createHarness({ symposium: DOC_URL });
        harness.client.update.mockRejectedValue(
          new OpenArtifactsClientError("Document is gone.", "not_found", 404, false)
        );
        const review = await startAgentReview(harness);

        const result = await review.options.onConfirm("delete", activeDocument);

        expect(result).toMatchObject({ kind: "failure", action: "update" });
        await expect(review.outcome).resolves.toEqual({
          status: "failed",
          message: "Document is gone.",
        });
        review.options.onClosed?.();
        expect(harness.client.update).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.frontmatter.symposium).toBe(DOC_URL);
        expect(harness.processFrontMatter).not.toHaveBeenCalled();
      });

      it("invalidates confirmation when the reviewed note identity changes", async () => {
        const harness = createHarness();
        const review = await startAgentReview(harness);
        harness.frontmatter.symposium = NEW_DOC_URL;

        const result = await review.options.onConfirm("publish", activeDocument);
        review.options.onClosed?.();

        expect(result).toMatchObject({
          kind: "failure",
          action: "publish",
          retryable: false,
        });
        await expect(review.outcome).resolves.toMatchObject({ status: "failed" });
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
      });

      it("fails closed when an existing identity disappears after review", async () => {
        const harness = createHarness({ symposium: DOC_URL });
        const review = await startAgentReview(harness);
        delete harness.frontmatter.symposium;

        const result = await review.options.onConfirm("publish", activeDocument);

        expect(result).toMatchObject({
          kind: "failure",
          action: "update",
          retryable: false,
        });
        await expect(review.outcome).resolves.toMatchObject({ status: "failed" });
        review.options.onClosed?.();
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
      });

      it("invalidates confirmation when the source path changes after review", async () => {
        const harness = createHarness();
        const review = await startAgentReview(harness);
        harness.file.path = "Notes/Renamed.md";

        const result = await review.options.onConfirm("publish", activeDocument);
        review.options.onClosed?.();

        expect(result).toMatchObject({ kind: "failure", action: "publish" });
        await expect(review.outcome).resolves.toMatchObject({ status: "failed" });
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
      });

      it("rechecks the source binding immediately before the request", async () => {
        const harness = createHarness();
        let resolveLicense: ((licenseKey: string) => void) | undefined;
        harness.loadLicenseKey.mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveLicense = resolve;
            })
        );
        const review = await startAgentReview(harness);

        const confirmation = review.options.onConfirm("publish", activeDocument);
        for (let turn = 0; turn < 20 && !resolveLicense; turn += 1) {
          await Promise.resolve();
        }
        harness.file.path = "Notes/Renamed.md";
        resolveLicense?.("decrypted-license");

        await expect(confirmation).resolves.toMatchObject({
          kind: "failure",
          action: "publish",
        });
        await expect(review.outcome).resolves.toMatchObject({ status: "failed" });
        review.options.onClosed?.();
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
      });

      it("reads the staged artifact before rejecting an invalid source path", async () => {
        const harness = createHarness();

        const outcome = await harness.publisher.reviewAgentPublish(
          "../outside.md",
          ".openartifacts/handoffs/review.html"
        );

        expect(outcome).toMatchObject({ status: "failed" });
        expect(harness.readStagedHtml).toHaveBeenCalledTimes(1);
        expect(harness.removePreview).toHaveBeenCalledTimes(1);
        expect(harness.openModal).not.toHaveBeenCalled();
      });

      it("does not report a previous blocked receipt as success for new reviewed bytes", async () => {
        const harness = createHarness();
        harness.processFrontMatter.mockRejectedValueOnce(new Error("vault is read-only"));
        const previous = await reviewAndConfirm(harness, "publish");

        const outcome = await harness.publisher.reviewAgentPublish(
          harness.file.path,
          ".openartifacts/handoffs/review.html"
        );

        expect(previous).toMatchObject({ kind: "persistence", action: "publish" });
        expect(outcome).toEqual({
          status: "failed",
          message:
            "The page is already public. Retry saving its link to this note; this will not publish again.",
        });
        expect(harness.readStagedHtml).toHaveBeenCalledTimes(2);
        // The blocked receipt short-circuits the second review, so only the
        // first one reached a modal and only one publish request was sent.
        expect(harness.openModal).toHaveBeenCalledTimes(1);
        expect(harness.client.publish).toHaveBeenCalledTimes(1);
      });

      it("rejects oversized staged HTML before opening review", async () => {
        const harness = createHarness();
        harness.readStagedHtml.mockResolvedValueOnce("x".repeat(OPENARTIFACTS_MAX_HTML_BYTES + 1));

        const outcome = await harness.publisher.reviewAgentPublish(
          harness.file.path,
          ".openartifacts/handoffs/oversized.html"
        );

        expect(outcome).toEqual({
          status: "failed",
          message: `OpenArtifacts HTML is ${OPENARTIFACTS_MAX_HTML_BYTES + 1} bytes; the limit is ${OPENARTIFACTS_MAX_HTML_BYTES} bytes.`,
        });
        expect(harness.readStagedHtml).toHaveBeenCalledTimes(1);
        expect(harness.removePreview).toHaveBeenCalledTimes(1);
        expect(harness.openModal).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();
      });

      it("rejects active HTML before opening review", async () => {
        const harness = createHarness();
        harness.readStagedHtml.mockResolvedValueOnce(
          '<!doctype html><meta http-equiv="refresh" content="0;url=https://attacker.example">'
        );

        const outcome = await harness.publisher.reviewAgentPublish(
          harness.file.path,
          ".openartifacts/handoffs/redirect.html"
        );

        expect(outcome).toEqual({
          status: "failed",
          message: "OpenArtifacts HTML is not publishable: remove the automatic redirect.",
        });
        expect(harness.openModal).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();
        expect(harness.client.update).not.toHaveBeenCalled();
      });

      it("fails before review when identity is malformed", async () => {
        const harness = createHarness({ symposium: { docId: DOC_ID } });

        const outcome = await harness.publisher.reviewAgentPublish(
          harness.file.path,
          ".openartifacts/handoffs/review.html"
        );

        expect(outcome.status).toBe("failed");
        if (outcome.status !== "failed") throw new Error("Expected a failed review outcome");
        expect(outcome.message).toContain("unrecognized value");
        expect(harness.readStagedHtml).toHaveBeenCalledTimes(1);
        expect(harness.openModal).not.toHaveBeenCalled();
        expect(harness.client.publish).not.toHaveBeenCalled();
      });
    });
  });
});
