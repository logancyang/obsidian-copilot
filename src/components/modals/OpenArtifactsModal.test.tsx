import type {
  OpenArtifactsAccessPort,
  OpenArtifactsModalOptions,
  OpenArtifactsModalResult,
} from "@/components/modals/OpenArtifactsModal";
import type { OpenArtifactsAccess, OpenArtifactsReceipt } from "@/openArtifacts/types";
import { OpenArtifactsClientError } from "@/openArtifacts/OpenArtifactsClient";
import { act, fireEvent, screen } from "@testing-library/react";

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

import { OpenArtifactsModal } from "@/components/modals/OpenArtifactsModal";
import type { App } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const RECEIPT: OpenArtifactsReceipt = {
  docId: DOC_ID,
  url: `https://openartifacts.site/d/${DOC_ID}?server=exact`,
  version: 2,
};
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/707";
const mountedModals: OpenArtifactsModal[] = [];

function accessFixture(overrides: Partial<OpenArtifactsAccess> = {}): OpenArtifactsAccess {
  return {
    docId: DOC_ID,
    url: `https://openartifacts.site/d/${DOC_ID}`,
    linkAccess: "invited",
    email: true,
    people: [],
    requests: [],
    ...overrides,
  };
}

function accessPort(overrides: Partial<OpenArtifactsAccessPort> = {}): OpenArtifactsAccessPort {
  return {
    load: jest.fn().mockResolvedValue(accessFixture()),
    setLinkAccess: jest.fn(),
    open: jest.fn(),
    ...overrides,
  };
}

function createConfirmMock(): jest.MockedFunction<OpenArtifactsModalOptions["onConfirm"]> {
  return jest.fn();
}

function renderModal(
  onConfirm: jest.MockedFunction<OpenArtifactsModalOptions["onConfirm"]>,
  docId: string | null = null,
  onClosed?: () => void,
  initialResult?: OpenArtifactsModalResult,
  access?: OpenArtifactsAccessPort,
  docUrl?: string
): OpenArtifactsModal {
  const modal = new OpenArtifactsModal({} as App, {
    fileName: "Architecture",
    docId,
    docUrl,
    initialResult,
    access,
    onConfirm,
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

describe("OpenArtifactsModal", () => {
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

  describe("OpenArtifactsModal", () => {
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

        expect(modal.modalEl.classList.contains("copilot-openartifacts-modal")).toBe(true);
        expectButtonsInSameRow("No, cancel", "Yes, publish");

        fireEvent.click(screen.getByRole("button", { name: "No, cancel" }));
        expect(baseClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();

        const publishModal = renderModal(onConfirm);
        await clickButton("Yes, publish");
        expect(onConfirm).toHaveBeenCalledWith("publish", activeDocument, "anyone");
        expect(publishModal.contentEl.childElementCount).toBeGreaterThan(0);
      });

      it("publishes privately when Only those invited is chosen", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "success",
          action: "publish",
          receipt: RECEIPT,
        });
        const port = accessPort({
          load: jest.fn().mockResolvedValue(accessFixture({ url: RECEIPT.url.split("?")[0] })),
        });
        renderModal(onConfirm, null, undefined, undefined, port);

        fireEvent.click(screen.getByRole("radio", { name: "Only those invited" }));
        expect(screen.getByText(/only people you invite/i)).toBeTruthy();
        await clickButton("Yes, publish");

        expect(onConfirm).toHaveBeenCalledWith("publish", activeDocument, "invited");
        expect(port.load).toHaveBeenCalledWith(DOC_ID);
        expect(await screen.findByText("Publish complete")).toBeTruthy();
        expect(
          await screen.findByRole("radio", { name: "Only those invited", checked: true })
        ).toBeTruthy();
      });

      it("opens the page through the owner route", async () => {
        const open = jest.spyOn(window, "open").mockImplementation(() => null);
        const port = accessPort({
          open: jest.fn().mockResolvedValue("https://x.openartifacts.site/d/g?grant=1"),
        });
        await act(async () => {
          renderModal(createConfirmMock(), DOC_ID, undefined, undefined, port);
        });

        await clickButton("Open");
        expect(open).toHaveBeenCalledWith(
          "https://x.openartifacts.site/d/g?grant=1",
          "_blank",
          "noopener,noreferrer"
        );
      });

      it(`${ISSUE} shows the copy notice after a real switch to private, not for a doc loaded as private`, async () => {
        const port = accessPort({
          load: jest.fn().mockResolvedValue(accessFixture({ linkAccess: "anyone" })),
          setLinkAccess: jest.fn().mockResolvedValue(accessFixture({ linkAccess: "invited" })),
        });
        await act(async () => {
          renderModal(createConfirmMock(), DOC_ID, undefined, undefined, port);
        });
        const notice = "People who opened it while it was public may have kept a copy.";
        expect(screen.queryByText(notice)).toBeNull();

        await act(async () => {
          fireEvent.click(screen.getByRole("radio", { name: "Only those invited" }));
        });

        expect(port.setLinkAccess).toHaveBeenCalledWith(DOC_ID, "invited");
        expect(screen.getByText(notice)).toBeTruthy();
      });

      it(`${ISSUE} does not show the copy notice for a doc that loads as private`, async () => {
        await act(async () => {
          renderModal(createConfirmMock(), DOC_ID, undefined, undefined, accessPort());
        });

        expect(screen.queryByText(/may have kept a copy/)).toBeNull();
      });

      it(`${ISSUE} drops the copy notice when the link goes back to anyone`, async () => {
        const port = accessPort({
          load: jest.fn().mockResolvedValue(accessFixture({ linkAccess: "anyone" })),
          setLinkAccess: jest
            .fn()
            .mockResolvedValueOnce(accessFixture({ linkAccess: "invited" }))
            .mockResolvedValueOnce(accessFixture({ linkAccess: "anyone" })),
        });
        await act(async () => {
          renderModal(createConfirmMock(), DOC_ID, undefined, undefined, port);
        });

        await act(async () => {
          fireEvent.click(screen.getByRole("radio", { name: "Only those invited" }));
        });
        expect(screen.getByText(/may have kept a copy/)).toBeTruthy();
        await act(async () => {
          fireEvent.click(screen.getByRole("radio", { name: "Anyone with the link" }));
        });
        expect(screen.queryByText(/may have kept a copy/)).toBeNull();
      });

      it(`${ISSUE} shows one muted line and keeps Update, Delete, Copy link and Open when the server does not support private documents`, async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const open = jest.spyOn(window, "open").mockImplementation(() => null);
        const message = "Not found, or this server does not support private documents.";
        const port = accessPort({
          load: jest
            .fn()
            .mockRejectedValue(
              new OpenArtifactsClientError(message, "private_unavailable", 404, false)
            ),
          open: jest.fn().mockResolvedValue(RECEIPT.url),
        });
        await act(async () => {
          renderModal(createConfirmMock(), DOC_ID, undefined, undefined, port, RECEIPT.url);
        });

        expect(screen.getByText(message)).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByRole("radio", { name: "Only those invited" })).toBeNull();
        expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();

        await clickButton("Copy link");
        expect(writeText).toHaveBeenCalledWith(RECEIPT.url);
        await clickButton("Open");
        expect(port.open).toHaveBeenCalledWith(DOC_ID);
        expect(open).toHaveBeenCalledWith(RECEIPT.url, "_blank", "noopener,noreferrer");
      });

      it(`${ISSUE} still shows the alert and Upgrade link for other access errors`, async () => {
        const port = accessPort({
          load: jest
            .fn()
            .mockRejectedValue(
              new OpenArtifactsClientError(
                "Private sharing needs a paid plan.",
                "limit_reached",
                402,
                false,
                "https://www.obsidiancopilot.com/pricing"
              )
            ),
        });
        await act(async () => {
          renderModal(createConfirmMock(), DOC_ID, undefined, undefined, port);
        });

        expect(screen.getByRole("alert").textContent).toContain(
          "Private sharing needs a paid plan."
        );
        expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe(
          "https://www.obsidiancopilot.com/pricing"
        );
      });

      it(`${ISSUE} shows an Upgrade link on a failed first private publish and creates nothing`, async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "failure",
          action: "publish",
          message: "Your Copilot plan does not include private sharing.",
          accessNotice: false,
          retryable: false,
          upgradeUrl:
            "https://www.obsidiancopilot.com/pricing?utm_medium=openartifacts_private_sharing",
        });
        renderModal(onConfirm);

        fireEvent.click(screen.getByRole("radio", { name: "Only those invited" }));
        await clickButton("Yes, publish");

        expect(await screen.findByText(/does not include private sharing/)).toBeTruthy();
        const link = screen.getByRole("link", { name: "Upgrade" });
        expect(link.getAttribute("href")).toBe(
          "https://www.obsidiancopilot.com/pricing?utm_medium=openartifacts_private_sharing"
        );
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      });

      it("shows no Upgrade link on a failure without one", async () => {
        const onConfirm = createConfirmMock().mockResolvedValue({
          kind: "failure",
          action: "publish",
          message: "Nope.",
          accessNotice: false,
          retryable: false,
        });
        renderModal(onConfirm);

        await clickButton("Yes, publish");

        expect(await screen.findByText("Nope.")).toBeTruthy();
        expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
      });

      it("allows native close while a confirmed action is pending", async () => {
        let resolveConfirm: ((result: OpenArtifactsModalResult) => void) | undefined;
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
        expect(onConfirm).toHaveBeenCalledWith("delete", activeDocument, "anyone");
        expect(await screen.findByText("Removed from OpenArtifacts")).toBeTruthy();
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

        expect(await screen.findByText("OpenArtifacts access required")).toBeTruthy();
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
          message: "The page is already published. Retry saving its document id.",
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
          message: "The page is already published. Retry saving its document id.",
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

      it("https://github.com/Brevilabs/OpenArtifacts/issues/94 shows the server's account-link offer verbatim with a Link account link only when the receipt carries guidance", async () => {
        const message = "Publish from other agents too? Link your account.";
        const guidance = { message, url: "https://openartifacts.ai/account" };
        const onConfirm = createConfirmMock()
          .mockResolvedValueOnce({ kind: "success", action: "publish", receipt: RECEIPT })
          .mockResolvedValueOnce({
            kind: "success",
            action: "publish",
            receipt: { ...RECEIPT, guidance },
          });

        renderModal(onConfirm);
        await clickButton("Yes, publish");
        expect(screen.queryByText(/Link account/)).toBeNull();

        renderModal(onConfirm);
        await clickButton("Yes, publish");
        expect(screen.getByText(message, { exact: false })).toBeTruthy();
        const link = screen.getByRole("link", { name: "Link account" });
        expect(link.getAttribute("href")).toBe(guidance.url);
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
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
