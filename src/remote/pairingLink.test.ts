import {
  buildPairingLink,
  PAIRING_ACTION,
  parsePairingLink,
  parsePairingParams,
} from "@/remote/pairingLink";

const PARAMS = {
  host: "100.118.223.39",
  port: 52341,
  vaultName: "Work notes",
  vaultId: "3f9a1c2e",
  secret: "k3Jd8sLq0Zt5vXw9bN2mRa7Y",
  desktopName: "Studio Mac",
};

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

describe("pairingLink", () => {
  describe("buildPairingLink()", () => {
    it("carries the address, port, vault name, vault id, desktop name and one-time secret as query parameters", () => {
      const link = new URL(buildPairingLink(PARAMS));

      expect(link.protocol).toBe("obsidian:");
      expect(link.host).toBe(PAIRING_ACTION);
      expect(Object.fromEntries(link.searchParams)).toEqual({
        host: PARAMS.host,
        port: "52341",
        vault: PARAMS.vaultName,
        vaultId: PARAMS.vaultId,
        secret: PARAMS.secret,
        desktop: PARAMS.desktopName,
      });
    });

    it("escapes a vault name that contains reserved characters so it round-trips", () => {
      const vaultName = "Q&A / notes #1?";

      expect(parsePairingLink(buildPairingLink({ ...PARAMS, vaultName }))?.vaultName).toBe(
        vaultName
      );
    });
  });

  describe("parsePairingLink()", () => {
    it("recovers every field from a link the desktop built", () => {
      expect(parsePairingLink(buildPairingLink(PARAMS))).toEqual(PARAMS);
    });

    it("tolerates whitespace around a pasted link", () => {
      expect(parsePairingLink(`  \n${buildPairingLink(PARAMS)}\n `)).toEqual(PARAMS);
    });

    it("rejects a link for a different obsidian action", () => {
      expect(parsePairingLink("obsidian://open?vault=x&host=100.64.0.1")).toBeNull();
    });

    it("rejects text that is not a link", () => {
      expect(parsePairingLink("hello")).toBeNull();
    });
  });

  describe("parsePairingParams()", () => {
    const raw = {
      host: PARAMS.host,
      port: "52341",
      vault: PARAMS.vaultName,
      vaultId: PARAMS.vaultId,
      secret: PARAMS.secret,
      desktop: PARAMS.desktopName,
    };

    it("accepts the parameters Obsidian hands a protocol handler", () => {
      expect(parsePairingParams({ action: "copilot-pair", ...raw })).toEqual(PARAMS);
    });

    it("accepts a link without a vault name and reports an empty one", () => {
      expect(parsePairingParams({ ...raw, vault: undefined })?.vaultName).toBe("");
    });

    it(`accepts a link without a desktop name and reports an empty one (${ISSUE})`, () => {
      expect(parsePairingParams({ ...raw, desktop: undefined })?.desktopName).toBe("");
    });

    it(`strips control characters from the desktop name and limits it to 60 characters so the phone can show it safely (${ISSUE})`, () => {
      const parsed = parsePairingParams({ ...raw, desktop: `Mac\u0007\n${"x".repeat(100)}` });

      expect(parsed?.desktopName).toHaveLength(60);
      expect(parsed?.desktopName.startsWith("Macxxx")).toBe(true);
    });

    it.each([
      ["missing host", { host: undefined }],
      ["missing secret", { secret: undefined }],
      ["missing vault id", { vaultId: undefined }],
      ["non-numeric port", { port: "abc" }],
      ["port below 1024", { port: "80" }],
      ["port above 65535", { port: "70000" }],
      ["malformed vault id", { vaultId: "not-a-vault-id" }],
      ["secret with illegal characters", { secret: "has spaces and ///" }],
      ["secret that is too short", { secret: "abc" }],
    ])("rejects a link with %s", (_label, override) => {
      expect(parsePairingParams({ ...raw, ...override })).toBeNull();
    });

    it.each(["192.168.1.20", "127.0.0.1", "8.8.8.8", "attacker.example.com", "100.077.0.1"])(
      "rejects host %s outside the Tailscale range so a forged link cannot aim the phone at a LAN or internet host (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)",
      (host) => {
        expect(parsePairingParams({ ...raw, host })).toBeNull();
      }
    );
  });
});
