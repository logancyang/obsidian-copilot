import { isProjectContextInline, withoutChatLists } from "@/agentMode/ui/landingChatLists";
import type { AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";

function section(id: string): AgentHomeShelfSection {
  return { id, icon: null, title: id, renderBody: () => null };
}

describe("landingChatLists", () => {
  describe("withoutChatLists()", () => {
    it("keeps the Relevant Notes shelf and drops Recent chats and Projects from the global landing for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      const global = [section("chats"), section("relevant-notes"), section("projects")];

      expect(withoutChatLists(global).map((s) => s.id)).toEqual(["relevant-notes"]);
    });

    it("returns an empty list when only chat lists exist", () => {
      expect(withoutChatLists([section("chats"), section("projects")])).toEqual([]);
    });
  });

  describe("isProjectContextInline()", () => {
    it("is true for a project that has no saved chats", () => {
      expect(isProjectContextInline(true, false)).toBe(true);
    });

    it("is false for a project with saved chats while the sessions sidebar is closed", () => {
      expect(isProjectContextInline(false, false)).toBe(false);
    });

    it("is false while the project's chat history has not settled and the sidebar is closed", () => {
      expect(isProjectContextInline(undefined, false)).toBe(false);
    });

    it("is true for a project with saved chats while the sessions sidebar is open, since the chat list is hidden, for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      expect(isProjectContextInline(false, true)).toBe(true);
    });

    it("is true while the project's chat history has not settled and the sidebar is open, so the context never waits on history, for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      expect(isProjectContextInline(undefined, true)).toBe(true);
    });
  });
});
