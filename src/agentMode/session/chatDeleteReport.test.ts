import { buildNativeChatId } from "@/utils/nativeChatId";
import { describeChatDeletePlan, formatChatDeleteNotice } from "./chatDeleteReport";

const CLAUDE = { displayName: "Claude", deletesSessionTranscript: true };
const CODEX = { displayName: "Codex" };
const OPENCODE = { displayName: "opencode" };

describe("chatDeleteReport", () => {
  describe("describeChatDeletePlan()", () => {
    it("names the chat file, index entry and transcript as removed for a Claude chat", () => {
      expect(describeChatDeletePlan("chats/agent__a.md", CLAUDE)).toBe(
        "Removes: chat file, session index entry and Claude transcript. Keeps: nothing."
      );
    });

    it.each([
      ["Codex", CODEX],
      ["opencode", OPENCODE],
    ])("says the %s transcript stays", (name, descriptor) => {
      expect(describeChatDeletePlan("chats/agent__a.md", descriptor)).toBe(
        `Removes: chat file and session index entry. Keeps: ${name} transcript.`
      );
    });

    it("leaves out the chat file for a chat that exists only in the session index", () => {
      expect(describeChatDeletePlan(buildNativeChatId("claude", "s1"), CLAUDE)).toBe(
        "Removes: session index entry and Claude transcript. Keeps: nothing."
      );
    });

    it("names only the chat file when the backend is unknown", () => {
      expect(describeChatDeletePlan("chats/agent__a.md", undefined)).toBe(
        "Removes: chat file. Keeps: nothing."
      );
    });
  });

  describe("formatChatDeleteNotice()", () => {
    it("says the chat was deleted when every copy was removed", () => {
      expect(
        formatChatDeleteNotice({
          removed: ["chat file", "session index entry", "Claude transcript"],
          kept: [],
          failed: [],
        })
      ).toBe("Chat deleted. Removed: chat file, session index entry and Claude transcript.");
    });

    it("does not say the chat was deleted when a backend transcript was left behind", () => {
      expect(
        formatChatDeleteNotice({
          removed: ["chat file", "session index entry"],
          kept: ["Codex transcript"],
          failed: [],
        })
      ).toBe("Removed: chat file and session index entry. Not removed: Codex transcript.");
    });

    it("calls the deletion partial and names the failed copy with its error", () => {
      expect(
        formatChatDeleteNotice({
          removed: ["chat file", "session index entry"],
          kept: [],
          failed: [{ copy: "Claude transcript", error: "EACCES" }],
        })
      ).toBe(
        "Deletion was partial. Removed: chat file and session index entry. Failed: Claude transcript (EACCES)."
      );
    });

    it("says the chat was not deleted when every step failed", () => {
      expect(
        formatChatDeleteNotice({
          removed: [],
          kept: [],
          failed: [{ copy: "chat file", error: "locked" }],
        })
      ).toBe("Chat was not deleted. Failed: chat file (locked).");
    });
  });
});
