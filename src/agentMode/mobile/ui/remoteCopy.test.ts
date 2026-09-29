import type { RemoteBanner, RemoteScreen } from "@/agentMode/mobile/remoteStatus";
import { describeBanner, describeScreen } from "@/agentMode/mobile/ui/remoteCopy";

describe("remoteCopy", () => {
  describe("describeScreen()", () => {
    it.each([
      [
        { kind: "connecting" },
        "Connecting to Studio Mac",
        "This can take a few seconds.",
        { tone: "neutral", busy: true, canRetry: false },
      ],
      [
        { kind: "syncing" },
        "Loading sessions from Studio Mac",
        "Connected. Waiting for the desktop's agent tabs.",
        { tone: "neutral", busy: true, canRetry: false },
      ],
      [
        { kind: "unreachable" },
        "Can't reach your desktop. Is Tailscale on?",
        "Check that Tailscale is running on this phone and on Studio Mac, and that Studio Mac is awake.",
        { tone: "error", busy: false, canRetry: true },
      ],
      [
        { kind: "offline" },
        "Studio Mac is offline",
        "Open Obsidian on Studio Mac and keep it awake. Copilot retries on its own.",
        { tone: "error", busy: false, canRetry: true },
      ],
      [
        { kind: "protocol" },
        "Studio Mac sent an unexpected reply",
        "Update Copilot on both devices, then try again.",
        { tone: "error", busy: false, canRetry: true },
      ],
      [
        { kind: "denied" },
        "Studio Mac no longer accepts this phone",
        "The desktop revoked this phone. Remove the desktop in Copilot settings under Remote, then pair again.",
        { tone: "error", busy: false, canRetry: false },
      ],
    ] as const)(
      "describes the %j screen with its title, guidance and whether it can be retried",
      (screen: RemoteScreen, title, detail, flags) => {
        expect(describeScreen(screen, "Studio Mac")).toEqual({ title, detail, ...flags });
      }
    );

    it("names both versions when the desktop runs a different Copilot", () => {
      const copy = describeScreen(
        {
          kind: "version_mismatch",
          local: { app: "4.1.0", protocol: 1 },
          remote: { app: "4.0.9", protocol: 1 },
        },
        "Studio Mac"
      );

      expect(copy.title).toBe("Update Copilot on both devices");
      expect(copy.detail).toContain("This phone runs Copilot 4.1.0 (protocol 1)");
      expect(copy.detail).toContain("Studio Mac runs Copilot 4.0.9 (protocol 1)");
      expect(copy).toMatchObject({ tone: "error", busy: false, canRetry: false });
    });

    it("says only that the versions differ when the desktop's version is unknown", () => {
      const copy = describeScreen(
        { kind: "version_mismatch", local: { app: "4.1.0", protocol: 1 }, remote: null },
        "Studio Mac"
      );

      expect(copy.detail).toContain("Studio Mac runs a different version of Copilot");
    });
  });

  describe("describeBanner()", () => {
    it.each([
      ["reconnecting", "Reconnecting to Studio Mac…"],
      ["offline", "Studio Mac is offline. Retrying…"],
      ["unreachable", "Can't reach your desktop. Is Tailscale on?"],
      ["protocol", "Studio Mac sent an unexpected reply. Retrying…"],
    ] as const)("words the %s banner for the user", (banner: RemoteBanner, text) => {
      expect(describeBanner(banner, "Studio Mac")).toBe(text);
    });
  });
});
