import { describePairOutcome } from "@/remote/client/pairMessages";

describe("pairMessages", () => {
  describe("describePairOutcome()", () => {
    it("names the desktop that was paired", () => {
      expect(
        describePairOutcome({
          ok: true,
          desktop: {
            id: "d",
            host: "100.64.0.1",
            port: 5000,
            token: "t",
            desktopName: "Studio Mac",
            vaultName: "Work",
            pairedAt: 1,
          },
        })
      ).toBe("Paired with Studio Mac.");
    });

    it("tells the user which vault to open when the link is for another vault", () => {
      expect(
        describePairOutcome({ ok: false, reason: "wrong-vault", vaultName: "Work notes" })
      ).toContain("Open that vault on this phone");
      expect(
        describePairOutcome({ ok: false, reason: "wrong-vault", vaultName: "Work notes" })
      ).toContain("Work notes");
    });

    it("still gives the instruction when the link carries no vault name", () => {
      expect(describePairOutcome({ ok: false, reason: "wrong-vault", vaultName: "" })).toContain(
        "different vault"
      );
    });

    it.each([
      ["invalid-link", "not a valid Copilot pairing link"],
      ["unreachable", "Tailscale"],
      ["expired-or-used", "expired or was already used"],
      ["cancelled", "Pairing cancelled"],
      ["desktop-failed", "could not save this pairing"],
      ["storage-failed", "Revoke this phone"],
      ["protocol", "Update Copilot on both devices"],
    ] as const)("explains a %s failure", (reason, phrase) => {
      expect(describePairOutcome({ ok: false, reason })).toContain(phrase);
    });
  });
});
