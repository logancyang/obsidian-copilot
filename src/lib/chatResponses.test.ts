import { groupResponses, joinResponseText } from "@/lib/chatResponses";

describe("chatResponses", () => {
  describe("groupResponses()", () => {
    it("puts a single reply after the user's message in a response whose last reply is that reply", () => {
      expect(groupResponses(["typed", "reply"])).toEqual([
        { messages: [0], replies: [] },
        { messages: [1], replies: [1] },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 keeps a reply, another agent's message and a second reply in one response, so its last reply is the second one", () => {
      expect(groupResponses(["typed", "reply", "other", "reply"])).toEqual([
        { messages: [0], replies: [] },
        { messages: [1, 2, 3], replies: [1, 3] },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 ends a response at each message the user typed, so two responses each keep their own last reply", () => {
      expect(groupResponses(["typed", "reply", "typed", "reply", "reply"])).toEqual([
        { messages: [0], replies: [] },
        { messages: [1], replies: [1] },
        { messages: [2], replies: [] },
        { messages: [3, 4], replies: [3, 4] },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 gives a response with no reply of the agent's own no last reply", () => {
      expect(groupResponses(["other", "typed"])).toEqual([
        { messages: [0], replies: [] },
        { messages: [1], replies: [] },
      ]);
    });

    it("returns no groups for an empty chat", () => {
      expect(groupResponses([])).toEqual([]);
    });
  });

  describe("joinResponseText()", () => {
    it("joins the replies' text in order with a blank line between them", () => {
      expect(joinResponseText(["I asked Maya.", "Maya found one wrong year."])).toBe(
        "I asked Maya.\n\nMaya found one wrong year."
      );
    });

    it("leaves out replies that have no text", () => {
      expect(joinResponseText(["", "  ", "Done."])).toBe("Done.");
    });
  });
});
