import { handlePairingLinkAction } from "@/remote/client/pairingAction";
import type { RemoteClient } from "@/remote/client/RemoteClient";

describe("pairingAction", () => {
  describe("handlePairingLinkAction()", () => {
    it("reports the outcome of pairing from the link's parameters", async () => {
      const client = {
        pairFromParams: jest.fn().mockResolvedValue({ ok: false, reason: "expired-or-used" }),
      } as unknown as RemoteClient;
      const notify = jest.fn();

      await handlePairingLinkAction(client, { action: "copilot-pair", secret: "s" }, notify);

      expect(client.pairFromParams).toHaveBeenCalledWith({ action: "copilot-pair", secret: "s" });
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("expired or was already used"));
    });

    it("tells a desktop user to open the link on the phone instead of pairing", async () => {
      const notify = jest.fn();

      await handlePairingLinkAction(undefined, { action: "copilot-pair" }, notify);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Open this pairing link on your phone")
      );
    });
  });
});
