import { pythonUtf8Env } from "@/agentMode/backends/shared/pythonUtf8Env";

const ISSUE_3867 = "https://github.com/logancyang/obsidian-copilot/issues/3867";
const INHERITED = { PATH: "C:\\Windows\\System32" };

describe("pythonUtf8Env", () => {
  describe("pythonUtf8Env()", () => {
    it(`turns on Python UTF-8 mode for agents on Windows, so printing note text on a GBK code page cannot raise UnicodeEncodeError (${ISSUE_3867})`, () => {
      expect(pythonUtf8Env(undefined, "win32", INHERITED)).toEqual({ PYTHONUTF8: "1" });
    });

    it.each(["darwin", "linux"] as const)(
      `adds nothing on %s, whose agents already default to UTF-8 (${ISSUE_3867})`,
      (platform) => {
        expect(pythonUtf8Env(undefined, platform, INHERITED)).toEqual({});
      }
    );

    it(`keeps a PYTHONUTF8 value Obsidian inherited from the user's environment (${ISSUE_3867})`, () => {
      expect(pythonUtf8Env(undefined, "win32", { ...INHERITED, PYTHONUTF8: "0" })).toEqual({});
    });

    it(`keeps a PYTHONUTF8 value set in the backend's environment overrides (${ISSUE_3867})`, () => {
      expect(pythonUtf8Env({ PYTHONUTF8: "0" }, "win32", INHERITED)).toEqual({});
    });

    it("returns the same frozen object on every call, so callers see a stable value", () => {
      expect(pythonUtf8Env(undefined, "win32", INHERITED)).toBe(
        pythonUtf8Env(undefined, "win32", INHERITED)
      );
      expect(pythonUtf8Env(undefined, "darwin", INHERITED)).toBe(
        pythonUtf8Env(undefined, "linux", INHERITED)
      );
    });
  });
});
