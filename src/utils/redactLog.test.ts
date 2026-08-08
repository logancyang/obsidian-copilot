import { redactLogText } from "@/utils/redactLog";

describe("redactLog", () => {
  describe("redactLogText()", () => {
    it("replaces a home-directory username in a Unix path but keeps the path shape", () => {
      expect(redactLogText('{"file":"/Users/chaoyang/vault/note.md"}')).toBe(
        '{"file":"/Users/<user>/vault/note.md"}'
      );
      expect(redactLogText("/home/logan/.config/app")).toBe("/home/<user>/.config/app");
    });

    it("replaces a Windows home-directory username", () => {
      expect(redactLogText("C:\\Users\\Logan\\AppData")).toBe("C:\\Users\\<user>\\AppData");
    });

    it("replaces email addresses", () => {
      expect(redactLogText("from logan@brevilabs.com to a@b.co")).toBe("from <email> to <email>");
    });

    it("replaces provider API keys by their recognizable prefix", () => {
      expect(redactLogText("key sk-ant-abcdef0123456789xyz")).toBe("key <secret>");
      expect(redactLogText("AIzaSyD1234567890abcdefghijk")).toBe("<secret>");
      expect(redactLogText("token ghp_0123456789abcdefghij0")).toBe("token <secret>");
    });

    it("removes a bearer token, whether or not it follows an Authorization field", () => {
      // Bare bearer: the scheme word stays, the token becomes a marker.
      expect(redactLogText("using bearer abcdef0123456789 now")).toBe("using bearer <token> now");
      // In an Authorization header both rules fire; either way the token is gone.
      const header = redactLogText("Authorization: Bearer abcdef0123456789");
      expect(header).not.toContain("abcdef0123456789");
      expect(header).toContain("<token>");
    });

    it("replaces the value of a key/secret/password field in JSON or key=value form", () => {
      expect(redactLogText('"api_key": "s3cr3tvalue123"')).toBe('"api_key": "<redacted>"');
      expect(redactLogText("password=hunter2secret")).toBe("password=<redacted>");
    });

    it("leaves text without private data unchanged", () => {
      const clean = "agent started, 3 tools available, elapsed 42ms";
      expect(redactLogText(clean)).toBe(clean);
    });

    it("is idempotent — re-redacting already-redacted text is a no-op", () => {
      const once = redactLogText("/Users/chaoyang/x and sk-abcdef0123456789");
      expect(redactLogText(once)).toBe(once);
    });
  });
});
