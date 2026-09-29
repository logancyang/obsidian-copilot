import type { LinkState } from "@/agentMode/mobile/RemoteSessionTransport";
import { deriveRemoteStatus, type RemoteStatusInput } from "@/agentMode/mobile/remoteStatus";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

const link = (overrides: Partial<LinkState> = {}): LinkState => ({
  phase: "connecting",
  failure: null,
  attempts: 0,
  ...overrides,
});

const input = (overrides: Partial<RemoteStatusInput> = {}): RemoteStatusInput => ({
  link: link(),
  connection: "connecting",
  hasReplica: false,
  local: { app: "3.4.0", protocol: 1 },
  remote: null,
  ...overrides,
});

describe("remoteStatus", () => {
  describe("deriveRemoteStatus()", () => {
    it("shows the connecting screen while the first connection is being made", () => {
      expect(deriveRemoteStatus(input())).toEqual({ screen: { kind: "connecting" }, banner: null });
    });

    it("shows the syncing screen when the socket is live but the tab list has not arrived", () => {
      expect(
        deriveRemoteStatus(input({ link: link({ phase: "open" }), connection: "live" }))
      ).toEqual({ screen: { kind: "syncing" }, banner: null });
    });

    it("shows the chat with no screen and no banner once live with a replica", () => {
      expect(
        deriveRemoteStatus(
          input({ link: link({ phase: "open" }), connection: "live", hasReplica: true })
        )
      ).toEqual({ screen: null, banner: null });
    });

    it.each([
      ["offline", "offline"],
      ["unreachable", "unreachable"],
      ["protocol", "protocol"],
    ] as const)(
      "shows the %s screen when the last attempt failed that way and there is no replica",
      (failure, kind) => {
        expect(
          deriveRemoteStatus(
            input({
              link: link({ phase: "retrying", failure, attempts: 2 }),
              connection: "offline",
            })
          )
        ).toEqual({ screen: { kind }, banner: null });
      }
    );

    it(`keeps the replica on screen and shows a reconnecting banner while redialing after a drop (${ISSUE})`, () => {
      expect(
        deriveRemoteStatus(
          input({
            link: link({ phase: "retrying", attempts: 1 }),
            connection: "reconnecting",
            hasReplica: true,
          })
        )
      ).toEqual({ screen: null, banner: "reconnecting" });
    });

    it.each(["offline", "unreachable"] as const)(
      `keeps the replica on screen with a %s banner when redialing keeps failing (${ISSUE})`,
      (failure) => {
        expect(
          deriveRemoteStatus(
            input({
              link: link({ phase: "retrying", failure, attempts: 3 }),
              connection: "reconnecting",
              hasReplica: true,
            })
          )
        ).toEqual({ screen: null, banner: failure });
      }
    );

    it(`keeps the failure on screen while the next attempt is dialing (${ISSUE})`, () => {
      expect(
        deriveRemoteStatus(
          input({ link: link({ phase: "connecting", failure: "unreachable", attempts: 1 }) })
        )
      ).toEqual({ screen: { kind: "unreachable" }, banner: null });
    });

    it(`shows the version screen with both versions even when a replica exists (${ISSUE})`, () => {
      expect(
        deriveRemoteStatus(
          input({
            link: link({ phase: "open" }),
            connection: "version_mismatch",
            hasReplica: true,
            remote: { v: 2, app: "3.5.0" },
          })
        )
      ).toEqual({
        screen: {
          kind: "version_mismatch",
          local: { app: "3.4.0", protocol: 1 },
          remote: { app: "3.5.0", protocol: 2 },
        },
        banner: null,
      });
    });

    it("shows the denied screen when the desktop rejected this phone", () => {
      expect(
        deriveRemoteStatus(input({ link: link({ phase: "denied" }), connection: "offline" }))
      ).toEqual({ screen: { kind: "denied" }, banner: null });
    });
  });
});
