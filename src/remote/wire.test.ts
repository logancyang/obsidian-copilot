import { parseClientFrame, parseServerFrame } from "@/remote/wire";

describe("wire", () => {
  describe("parseClientFrame()", () => {
    it("reads a pair frame with its secret and device name", () => {
      expect(
        parseClientFrame(JSON.stringify({ type: "pair", secret: "s3cret", deviceName: "iPhone" }))
      ).toEqual({ type: "pair", secret: "s3cret", deviceName: "iPhone" });
    });

    it("reads an auth frame with its token", () => {
      expect(parseClientFrame(JSON.stringify({ type: "auth", token: "tok" }))).toEqual({
        type: "auth",
        token: "tok",
      });
    });

    it("truncates an over-long device name instead of rejecting the pairing", () => {
      const frame = parseClientFrame(
        JSON.stringify({ type: "pair", secret: "s", deviceName: "x".repeat(500) })
      );

      expect(frame?.type === "pair" && frame.deviceName.length).toBe(200);
    });

    it.each([
      ["text that is not JSON", "hello"],
      ["a JSON array", "[]"],
      ["JSON null", "null"],
      ["an unknown frame type", JSON.stringify({ type: "hello", v: 1 })],
      ["a pair frame without a secret", JSON.stringify({ type: "pair", deviceName: "x" })],
      ["a pair frame without a device name", JSON.stringify({ type: "pair", secret: "s" })],
      ["an auth frame with an empty token", JSON.stringify({ type: "auth", token: "" })],
      ["an auth frame with a numeric token", JSON.stringify({ type: "auth", token: 5 })],
      [
        "an auth frame with an oversized token",
        JSON.stringify({ type: "auth", token: "t".repeat(129) }),
      ],
    ])("rejects %s", (_label, text) => {
      expect(parseClientFrame(text)).toBeNull();
    });
  });

  describe("parseServerFrame()", () => {
    it("reads a paired frame", () => {
      const frame = { type: "paired", token: "tok", deviceId: "d1", desktopName: "Studio Mac" };

      expect(parseServerFrame(JSON.stringify(frame))).toEqual(frame);
    });

    it("reads an authed frame", () => {
      expect(parseServerFrame(JSON.stringify({ type: "authed", deviceId: "d1" }))).toEqual({
        type: "authed",
        deviceId: "d1",
      });
    });

    it.each(["pairing-rejected", "token-rejected", "bad-request"])(
      "reads a denied frame with reason %s",
      (reason) => {
        expect(parseServerFrame(JSON.stringify({ type: "denied", reason }))).toEqual({
          type: "denied",
          reason,
        });
      }
    );

    it.each([
      ["a denied frame with an unknown reason", { type: "denied", reason: "because" }],
      ["a paired frame without a token", { type: "paired", deviceId: "d", desktopName: "x" }],
      ["an authed frame without a device id", { type: "authed" }],
      ["a session-protocol frame", { type: "snapshot", scope: "host" }],
    ])("rejects %s", (_label, frame) => {
      expect(parseServerFrame(JSON.stringify(frame))).toBeNull();
    });

    it("rejects text that is not JSON", () => {
      expect(parseServerFrame("{oops")).toBeNull();
    });
  });
});
