import { agentMentionsBlock, mentionedAgentNames } from "@/agents/agentMentionPrompt";
import { LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";

describe("agentMentionPrompt", () => {
  describe("mentionedAgentNames()", () => {
    it("names each agent the message @-mentions, in the roster's order", () => {
      expect(
        mentionedAgentNames("@Leo and @Maya, does the budget hold?", [MAYA, LEO, NORA])
      ).toEqual(["Maya", "Leo"]);
    });

    it("finds a mention typed in another case or followed by punctuation", () => {
      expect(mentionedAgentNames("what does @maya's review say? ask @LEO.", [MAYA, LEO])).toEqual([
        "Maya",
        "Leo",
      ]);
    });

    it(`ignores a name that only starts a longer word or sits inside an address (${ISSUE})`, () => {
      expect(mentionedAgentNames("@Mayan ruins, mail leo@leo.dev", [MAYA, LEO])).toEqual([]);
    });

    it("finds a name with spaces and symbols", () => {
      const named = { ...NORA, name: "Nora · Family & School" };

      expect(mentionedAgentNames("@Nora · Family & School who picks up?", [named])).toEqual([
        "Nora · Family & School",
      ]);
    });
  });

  describe("agentMentionsBlock()", () => {
    it("adds nothing to a message that mentions no agent", () => {
      expect(agentMentionsBlock(undefined)).toBeNull();
      expect(agentMentionsBlock([])).toBeNull();
    });

    it(`tells the agent to ask each mentioned agent with the ask_agent tool (${ISSUE})`, () => {
      expect(agentMentionsBlock(["Maya", "Leo"])).toBe(
        [
          "<copilot-agents>",
          "The user @-mentioned these custom agents in this message. Ask each of them with the ask_agent tool:",
          "- Maya",
          "- Leo",
          "</copilot-agents>",
        ].join("\n")
      );
    });
  });
});
