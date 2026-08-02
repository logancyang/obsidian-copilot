import type {
  SymposiumDocumentReview,
  SymposiumModalOptions,
  SymposiumModalResult,
} from "@/components/modals/SymposiumModal";
import type { SymposiumReceipt } from "@/symposium/types";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { act, fireEvent, screen } from "@testing-library/react";

jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));

jest.mock("obsidian", () => ({
  App: class App {},
  Modal: class Modal {
    app: unknown;
    baseClose = jest.fn();
    contentEl = activeDocument.createElement("div");
    modalEl = activeDocument.createElement("div");
    titleEl = activeDocument.createElement("div");

    constructor(app: unknown) {
      this.app = app;
      this.contentEl.empty = () => {
        this.contentEl.replaceChildren();
      };
      this.titleEl.setText = (text: string) => {
        this.titleEl.textContent = text;
      };
    }

    close(): void {
      this.baseClose();
      (this as unknown as { onClose?: () => void }).onClose?.();
    }
  },
}));

import { SymposiumModal } from "@/components/modals/SymposiumModal";
import type { App } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const RECEIPT: SymposiumReceipt = {
  docId: DOC_ID,
  url: `https://symposium.md/d/${DOC_ID}?server=exact`,
  version: 2,
};
const REVIEW_HTML = "<!doctype html><html><body>Exact review</body></html>\n";
const REVIEW: SymposiumDocumentReview = {
  sourcePath: "Notes/Architecture.md",
  digest: "a".repeat(64),
  previewPath: "/tmp/copilot-symposium-preview/preview.html",
  previewUrl: "file:///tmp/copilot-symposium-preview/preview.html",
  payload: Object.freeze({
    title: "Architecture",
    html: REVIEW_HTML,
    byteLength: new TextEncoder().encode(REVIEW_HTML).byteLength,
  }),
};

const mountedModals: SymposiumModal[] = [];

function createConfirmMock(): jest.MockedFunction<SymposiumModalOptions["onConfirm"]> {
  return jest.fn();
}

function renderModal(
  onConfirm: jest.MockedFunction<SymposiumModalOptions["onConfirm"]>,
  docId: string | null = null,
  onClosed?: () => void,
  initialResult?: SymposiumModalResult,
  review?: SymposiumDocumentReview,
  onRegenerate?: () => void
): SymposiumModal {
  const modal = new SymposiumModal({} as App, {
    fileName: "Architecture",
    docId,
    review,
    initialResult,
    onConfirm,
    onRegenerate,
    onClosed,
  });
  activeDocument.body.appendChild(modal.contentEl);
  act(() => {
    modal.onOpen();
  });
  mountedModals.push(modal);
  return modal;
}

async function clickButton(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function expectButtonsInSameRow(...names: string[]): void {
  const buttons = names.map((name) => screen.getByRole("button", { name }));
  const row = buttons[0].parentElement;
  expect(row).not.toBeNull();
  for (const button of buttons) {
    expect(button.parentElement).toBe(row);
  }
}

describe("SymposiumModal", () => {
  afterEach(() => {
    for (const modal of mountedModals.splice(0)) {
      act(() => {
        modal.onClose();
      });
    }
    activeDocument.body.innerHTML = "";
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("SymposiumModal", () => {
    describe("onOpen()", () => {
      it("shows a compact explicit publish confirmation with the note name and warning", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "success",
          action: "publish",
          receipt: RECEIPT,
        });
        const modal = renderModal(onConfirm);
        const baseClose = (modal as unknown as { baseClose: jest.Mock }).baseClose;

        expect(screen.getByText("Publish “Architecture”?")).toBeTruthy();
        expect(screen.getByText(/anyone with the public link/i)).toBeTruthy();
        expect(screen.queryByText(/theme/i)).toBeNull();
        expect(screen.queryByText(/preview/i)).toBeNull();

        expect(modal.modalEl.classList.contains("copilot-symposium-modal")).toBe(true);
        expectButtonsInSameRow("No, cancel", "Yes, publish");

        fireEvent.click(screen.getByRole("button", { name: "No, cancel" }));
        expect(baseClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();

        const publishModal = renderModal(onConfirm);
        await clickButton("Yes, publish");
        expect(onConfirm).toHaveBeenCalledWith("publish", activeDocument);
        expect(publishModal.contentEl.childElementCount).toBeGreaterThan(0);
      });

      it("links to the sandboxed local preview in the default browser and cancels without confirming", () => {
        const onConfirm = createConfirmMock();
        const modal = renderModal(onConfirm, null, undefined, undefined, REVIEW, jest.fn());
        const baseClose = (modal as unknown as { baseClose: jest.Mock }).baseClose;

        expect(screen.getByText("Review “Architecture”")).toBeTruthy();
        expect(screen.getByText(REVIEW.sourcePath)).toBeTruthy();
        expect(screen.getByText(REVIEW.payload.title)).toBeTruthy();
        expect(screen.getByText(`${REVIEW.payload.byteLength} bytes`)).toBeTruthy();
        expect(screen.getByText(REVIEW.digest)).toBeTruthy();
        expect(screen.queryByTitle("Symposium HTML preview")).toBeNull();
        expect(
          screen.getByText(/open a sandboxed local preview of these exact html bytes/i)
        ).toBeTruthy();
        const previewLink = screen.getByRole("link", { name: "Open local HTML preview" });
        expect(previewLink.getAttribute("href")).toBe(REVIEW.previewUrl);
        expect(previewLink.getAttribute("title")).toBe(REVIEW.previewPath);
        expect(previewLink.getAttribute("target")).toBe("_blank");
        expect(previewLink.getAttribute("rel")).toBe("noopener noreferrer");
        fireEvent.click(previewLink);
        expect(openWithSystemDefault).toHaveBeenCalledWith(REVIEW.previewPath);
        expectButtonsInSameRow("Ask agent to regenerate", "No, cancel", "Yes, publish");

        fireEvent.click(screen.getByRole("button", { name: "No, cancel" }));

        expect(baseClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
      });

      it("returns regeneration without reusing the current confirmation", () => {
        const onConfirm = createConfirmMock();
        const onRegenerate = jest.fn();
        const modal = renderModal(onConfirm, DOC_ID, undefined, undefined, REVIEW, onRegenerate);
        const baseClose = (modal as unknown as { baseClose: jest.Mock }).baseClose;

        expect(screen.getByRole("button", { name: "Yes, update" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Ask agent to regenerate" }));

        expect(onRegenerate).toHaveBeenCalledTimes(1);
        expect(baseClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
      });

      it("treats a confirmed agent review failure as terminal instead of retrying unseen state", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "failure",
          action: "update",
          message: "Symposium is temporarily unavailable.",
          accessNotice: false,
          retryable: true,
        });
        renderModal(onConfirm, DOC_ID, undefined, undefined, REVIEW, jest.fn());

        await clickButton("Yes, update");

        expect(await screen.findByText("Update failed")).toBeTruthy();
        expect(screen.getByText("Symposium is temporarily unavailable.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      });

      it("allows native close while a confirmed action is pending", async () => {
        let resolveConfirm: ((result: SymposiumModalResult) => void) | undefined;
        const onConfirm = createConfirmMock().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveConfirm = resolve;
            })
        );
        const onClosed = jest.fn();
        const modal = renderModal(onConfirm, null, onClosed);
        const baseClose = (modal as unknown as { baseClose: jest.Mock }).baseClose;

        fireEvent.click(screen.getByRole("button", { name: "Yes, publish" }));
        expect(screen.getByRole("button", { name: "Publishing…" })).toBeTruthy();

        act(() => {
          modal.close();
        });

        expect(baseClose).toHaveBeenCalledTimes(1);
        expect(modal.contentEl.childElementCount).toBe(0);
        expect(onClosed).toHaveBeenCalledTimes(1);

        await act(async () => {
          resolveConfirm?.({
            kind: "success",
            action: "publish",
            receipt: RECEIPT,
          });
        });

        expect(baseClose).toHaveBeenCalledTimes(1);
      });

      it("replaces the manage actions with delete confirmation before deleting", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "success",
          action: "delete",
        });
        renderModal(onConfirm, DOC_ID);

        expect(screen.getByText("Manage “Architecture”")).toBeTruthy();
        expectButtonsInSameRow("Cancel", "Update", "Delete");

        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        expect(screen.getByText("Delete “Architecture”?")).toBeTruthy();
        expect(
          screen.getByText(/previously fetched or cached copies cannot be recalled/i)
        ).toBeTruthy();
        expectButtonsInSameRow("No, cancel", "Yes, delete");
        expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
        expect(onConfirm).not.toHaveBeenCalled();

        await clickButton("Yes, delete");
        expect(onConfirm).toHaveBeenCalledWith("delete", activeDocument);
        expect(await screen.findByText("Removed from Symposium")).toBeTruthy();
      });

      it("shows the server's unauthorized message as a non-retryable access notice", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "failure",
          action: "publish",
          message: "Publishing is currently limited to lifetime license holders.",
          accessNotice: true,
          retryable: false,
        });
        renderModal(onConfirm);

        await clickButton("Yes, publish");

        expect(await screen.findByText("Symposium access required")).toBeTruthy();
        expect(
          screen.getByText("Publishing is currently limited to lifetime license holders.")
        ).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      });

      it("offers retry for an internal failure and then shows the returned receipt", async () => {
        const onConfirm = createConfirmMock()
          .mockResolvedValueOnce({
            kind: "failure",
            action: "publish",
            message: "License validation is temporarily unavailable.",
            accessNotice: false,
            retryable: true,
          })
          .mockResolvedValueOnce({
            kind: "success",
            action: "publish",
            receipt: RECEIPT,
          });
        renderModal(onConfirm);

        await clickButton("Yes, publish");
        expect(await screen.findByText("Publish failed")).toBeTruthy();

        await clickButton("Retry");
        expect(await screen.findByText(RECEIPT.url)).toBeTruthy();
        expect(screen.getByText(`Document ${DOC_ID} · Version 2`)).toBeTruthy();
        expect(onConfirm).toHaveBeenCalledTimes(2);
      });

      it("retries a partial-success save without repeating the confirmed network action", async () => {
        const retrySave = jest.fn().mockResolvedValue({
          kind: "success",
          action: "publish",
          receipt: RECEIPT,
        });
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "persistence",
          action: "publish",
          message: "The page is already public. Retry saving its document id.",
          receipt: RECEIPT,
          retrySave,
        });
        renderModal(onConfirm);

        await clickButton("Yes, publish");
        expect(await screen.findByText("Published, but not saved to the note")).toBeTruthy();
        expect(screen.getByText(RECEIPT.url)).toBeTruthy();
        expectButtonsInSameRow("Close", "Retry save", "Copy", "Open");

        await clickButton("Retry save");
        expect(retrySave).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(await screen.findByText("Publish complete")).toBeTruthy();
      });

      it("resumes an initial partial-success save without confirming another publish", async () => {
        const retrySave = jest.fn().mockResolvedValue({
          kind: "success",
          action: "publish",
          receipt: RECEIPT,
        });
        const onConfirm = createConfirmMock();
        renderModal(onConfirm, null, undefined, {
          kind: "persistence",
          action: "publish",
          message: "The page is already public. Retry saving its document id.",
          receipt: RECEIPT,
          retrySave,
        });

        expect(screen.getByText("Published, but not saved to the note")).toBeTruthy();
        expect(screen.getByText(RECEIPT.url)).toBeTruthy();

        await clickButton("Retry save");

        expect(retrySave).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(await screen.findByText("Publish complete")).toBeTruthy();
      });

      it("shows an update receipt as partial success when the note identity is not verified", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "persistence",
          action: "update",
          message: "The original page was updated, but this note's identity changed.",
          receipt: RECEIPT,
        });
        renderModal(onConfirm, DOC_ID);

        fireEvent.click(screen.getByRole("button", { name: "Update" }));
        expect(screen.getByText("Update “Architecture”?")).toBeTruthy();
        expectButtonsInSameRow("No, cancel", "Yes, update");
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
        expect(onConfirm).not.toHaveBeenCalled();

        await clickButton("Yes, update");

        expect(await screen.findByText("Page updated; note identity not verified")).toBeTruthy();
        expect(
          screen.getByText("The original page was updated, but this note's identity changed.")
        ).toBeTruthy();
        expect(screen.getByText(RECEIPT.url)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
      });

      it("copies and opens the API-returned URL from the success view", async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const open = jest.spyOn(window, "open").mockImplementation(() => null);
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "success",
          action: "update",
          receipt: RECEIPT,
        });
        renderModal(onConfirm, DOC_ID);

        fireEvent.click(screen.getByRole("button", { name: "Update" }));
        await clickButton("Yes, update");
        expectButtonsInSameRow("Close", "Copy", "Open");
        const link = screen.getByRole("link", { name: RECEIPT.url });
        expect(link.getAttribute("href")).toBe(RECEIPT.url);
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
        await clickButton("Copy");
        fireEvent.click(screen.getByRole("button", { name: "Open" }));

        expect(writeText).toHaveBeenCalledWith(RECEIPT.url);
        expect(open).toHaveBeenCalledWith(RECEIPT.url, "_blank", "noopener,noreferrer");
      });
    });

    describe("onClose()", () => {
      it("unmounts and clears the modal content", () => {
        const onConfirm = createConfirmMock();
        const modal = renderModal(onConfirm);
        expect(modal.contentEl.childElementCount).toBeGreaterThan(0);

        act(() => {
          modal.onClose();
        });

        expect(modal.contentEl.childElementCount).toBe(0);
      });
    });
  });
});
