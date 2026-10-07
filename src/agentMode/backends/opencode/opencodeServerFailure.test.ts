import { opencodeServerFailureCause } from "./opencodeServerFailure";

const ICLOUD_EPERM_LINE = String.raw`timestamp=2026-10-07T01:44:26.778Z level=INFO run=aa06330d cause="PlatformError: Unknown: FileSystem.realPath (/Users/ada/Library/Mobile Documents)\n    at Xl (/$bunfs/root/chunk-am33zcrz.js:2:720)\n    at <anonymous> (/$bunfs/root/chunk-29wecs65.js:24:40272)\n    at ServerProcess.start (definition) (/$bunfs/root/chunk-tmmyk4zh.js:453:24128) {\n  [cause]: Error: EPERM: operation not permitted, lstat '/Users/ada/Library/Mobile Documents'\n}" http.span=9 role=server http.method=GET http.url=/api/model http.status=500`;

describe("opencodeServerFailure", () => {
  describe("opencodeServerFailureCause()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/662 returns the logged error chain of an OpenCode HTTP 500 line without stack frames", () => {
      expect(opencodeServerFailureCause(ICLOUD_EPERM_LINE)).toBe(
        [
          "PlatformError: Unknown: FileSystem.realPath (/Users/<user>/Library/Mobile Documents)",
          "[cause]: Error: EPERM: operation not permitted, lstat '/Users/<user>/Library/Mobile Documents'",
        ].join("\n")
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/662 keeps closing braces that belong to the logged message", () => {
      const line = String.raw`level=INFO cause="Error: provider replied {\n  \"error\": \"overloaded\"\n}\n    at send (/$bunfs/root/chunk.js:1:1)" http.status=502`;

      expect(opencodeServerFailureCause(line)).toBe(
        ["Error: provider replied {", '"error": "overloaded"', "}"].join("\n")
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/662 unescapes quotes and backslashes inside the cause", () => {
      const line = String.raw`level=INFO cause="Error: {\"status\":500} at C:\\notes" http.status=503`;

      expect(opencodeServerFailureCause(line)).toBe(String.raw`Error: {"status":500} at C:\notes`);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/662 ignores lines whose request did not fail with a 5xx status", () => {
      expect(
        opencodeServerFailureCause(ICLOUD_EPERM_LINE.replace("http.status=500", "http.status=200"))
      ).toBeNull();
      expect(
        opencodeServerFailureCause(ICLOUD_EPERM_LINE.replace("http.status=500", "http.status=5000"))
      ).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/662 ignores a 5xx line without a complete cause", () => {
      expect(
        opencodeServerFailureCause("level=INFO http.url=/api/model http.status=500")
      ).toBeNull();
      expect(
        opencodeServerFailureCause('level=INFO cause="Error: cut off http.status=500')
      ).toBeNull();
      expect(opencodeServerFailureCause('level=INFO cause="   " http.status=500')).toBeNull();
    });
  });
});
