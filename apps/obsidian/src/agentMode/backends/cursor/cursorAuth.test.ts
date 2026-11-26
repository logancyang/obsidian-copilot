const mockExecFileAsync = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) => {
    if (id !== "child_process") return jest.requireActual(`node:${id}`);
    const execFile = Object.assign(jest.fn(), {
      [jest.requireActual<typeof import("node:util")>("node:util").promisify.custom]:
        mockExecFileAsync,
    });
    return { execFile };
  },
}));
import { signInWithCli, signOutWithCli } from "@/agentMode/backends/shared/cliSignIn";
jest.mock("@/agentMode/backends/shared/cliSignIn", () => ({
  signInWithCli: jest.fn(),
  signOutWithCli: jest.fn(),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
import {
  getCursorAuthStatus,
  parseCursorAuthStatus,
  readCursorAuthStatus,
  signInToCursor,
  signOutFromCursor,
} from "./cursorAuth";

describe("cursorAuth", () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });
  describe("parseCursorAuthStatus()", () => {
    it("reports a signed-in account when Cursor includes an email", () => {
      expect(
        parseCursorAuthStatus(
          JSON.stringify({ isAuthenticated: true, email: " zero@example.com " })
        )
      ).toEqual({ loggedIn: true, label: "zero@example.com" });
    });

    it("reports signed in without a label when the account has no email", () => {
      expect(parseCursorAuthStatus(JSON.stringify({ status: "authenticated" }))).toEqual({
        loggedIn: true,
      });
    });

    it("reports signed out from the documented unauthenticated payload", () => {
      expect(
        parseCursorAuthStatus(
          JSON.stringify({
            status: "unauthenticated",
            isAuthenticated: false,
            message: "Not logged in",
          })
        )
      ).toEqual({ loggedIn: false });
    });

    it("refuses a payload that does not say whether the account is signed in", () => {
      expect(() => parseCursorAuthStatus(JSON.stringify({ email: "zero@example.com" }))).toThrow(
        "Unable to verify Cursor authentication status."
      );
    });
  });

  describe("getCursorAuthStatus()", () => {
    it("treats malformed status output as signed out", async () => {
      mockExecFileAsync.mockResolvedValueOnce({ stdout: "not json" });
      await expect(getCursorAuthStatus("/bin/agent", {})).resolves.toEqual({ loggedIn: false });
    });
  });

  describe("readCursorAuthStatus()", () => {
    it("treats CURSOR_API_KEY as signed in without asking the CLI", async () => {
      await expect(
        readCursorAuthStatus("/bin/agent", { CURSOR_API_KEY: "cursor-key" })
      ).resolves.toEqual({ loggedIn: true });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it("asks the CLI for status when no API key or auth token is set", async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ isAuthenticated: false, status: "unauthenticated" }),
      });
      await expect(readCursorAuthStatus("/bin/agent", {})).resolves.toEqual({ loggedIn: false });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "/bin/agent",
        ["status", "--format", "json"],
        expect.objectContaining({ timeout: 10000 })
      );
    });
  });

  describe("signInToCursor()", () => {
    it("starts browser login and only treats a Cursor login page as the sign-in link", () => {
      const controller = { done: Promise.resolve({ loggedIn: false }), cancel: jest.fn() };
      jest.mocked(signInWithCli).mockReturnValue(controller);
      const handlers = { onUrl: jest.fn() };

      expect(signInToCursor("/bin/agent", {}, handlers)).toBe(controller);

      const acceptUrl = jest.mocked(signInWithCli).mock.calls[0][4]?.acceptUrl;
      expect(signInWithCli).toHaveBeenCalledWith(
        "/bin/agent",
        ["login"],
        {},
        expect.any(Function),
        expect.objectContaining({ onUrl: handlers.onUrl, acceptUrl: expect.any(Function) })
      );
      expect(acceptUrl?.("https://cursor.com/loginDeepControl?challenge=abc")).toBe(true);
      expect(acceptUrl?.("https://cursor.com/docs/cli")).toBe(false);
      expect(acceptUrl?.("https://example.com/login")).toBe(false);
    });
  });

  describe("signOutFromCursor()", () => {
    it("stays signed in when an API key remains after logout", async () => {
      jest
        .mocked(signOutWithCli)
        .mockImplementation(async (_command, _args, env, readStatus) => readStatus());
      await expect(
        signOutFromCursor("/bin/agent", { CURSOR_AUTH_TOKEN: "token" })
      ).resolves.toEqual({ loggedIn: true });
    });

    it("rejects logout when the follow-up status cannot be verified", async () => {
      mockExecFileAsync.mockRejectedValue(new Error("status startup failed"));
      jest
        .mocked(signOutWithCli)
        .mockImplementation(async (_command, _args, _env, readStatus) => readStatus());
      await expect(signOutFromCursor("/bin/agent", {})).rejects.toThrow("status startup failed");
    });
  });
});
