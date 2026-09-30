import { buildNativeChatId, isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";

describe("nativeChatId", () => {
  describe("buildNativeChatId()", () => {
    it("builds an id that parseNativeChatId reads back, including separators in the session id", () => {
      const id = buildNativeChatId("codex", "abc/def:ghi");
      expect(parseNativeChatId(id)).toEqual({ backendId: "codex", sessionId: "abc/def:ghi" });
    });
  });

  describe("isNativeChatId()", () => {
    it("accepts built ids and rejects note paths", () => {
      expect(isNativeChatId(buildNativeChatId("codex", "s1"))).toBe(true);
      expect(isNativeChatId("chats/agent__foo.md")).toBe(false);
    });
  });

  describe("parseNativeChatId()", () => {
    it("returns null for a note path", () => {
      expect(parseNativeChatId("chats/agent__foo.md")).toBeNull();
    });

    it("returns null when the backend/session separator is missing", () => {
      expect(parseNativeChatId("copilot-agent-session://no-separator")).toBeNull();
    });

    it("returns null when the session id is empty", () => {
      expect(parseNativeChatId("copilot-agent-session://backend/")).toBeNull();
    });
  });
});
