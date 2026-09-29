import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { confirmPairing } from "@/remote/client/confirmPairing";
import type { PairingConfirmation } from "@/remote/client/RemoteClient";
import type { App } from "obsidian";

jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";
const details: PairingConfirmation = {
  desktopName: "Studio Mac",
  address: "100.64.0.7:52341",
  linkVaultName: "Work notes",
  openVaultName: "Work notes",
};

describe("confirmPairing", () => {
  describe("confirmPairing()", () => {
    beforeEach(() => jest.clearAllMocks());

    function openDialog() {
      const app = {} as App;
      const answer = confirmPairing(app, details);
      const [modalApp, onConfirm, content, title, confirmText, cancelText, onCancel] = (
        ConfirmModal as unknown as jest.Mock
      ).mock.calls[0] as [App, () => void, unknown, string, string, string, () => void];
      return {
        app,
        answer,
        modalApp,
        onConfirm,
        content,
        title,
        confirmText,
        cancelText,
        onCancel,
      };
    }

    it(`opens a dialog titled for the desktop with Pair and Cancel buttons (${ISSUE})`, () => {
      const dialog = openDialog();

      expect(dialog.modalApp).toBe(dialog.app);
      expect([dialog.title, dialog.confirmText, dialog.cancelText]).toEqual([
        "Pair with this desktop?",
        "Pair",
        "Cancel",
      ]);
      expect((ConfirmModal as unknown as jest.Mock).mock.results[0].value.open).toHaveBeenCalled();
    });

    it(`resolves true when the person chooses Pair (${ISSUE})`, async () => {
      const dialog = openDialog();

      dialog.onConfirm();

      await expect(dialog.answer).resolves.toBe(true);
    });

    it(`resolves false when the person cancels or dismisses the dialog (${ISSUE})`, async () => {
      const dialog = openDialog();

      dialog.onCancel();

      await expect(dialog.answer).resolves.toBe(false);
    });
  });
});
