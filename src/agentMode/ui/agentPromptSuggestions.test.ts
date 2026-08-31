import { getAgentPromptSuggestions } from "@/agentMode/ui/agentPromptSuggestions";
import { t } from "@/i18n";

jest.mock("@/i18n", () => ({ t: jest.fn() }));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/326";
const mockT = t as jest.MockedFunction<typeof t>;

describe("agentPromptSuggestions", () => {
  describe("getAgentPromptSuggestions()", () => {
    it(`keeps one reference until the reviewed locale-specific suggestions change for ${ISSUE_URL}`, () => {
      mockT.mockReturnValue("First suggestion|Second suggestion");
      const first = getAgentPromptSuggestions();
      expect(getAgentPromptSuggestions()).toBe(first);

      mockT.mockReturnValue("第一条建议|第二条建议");
      expect(getAgentPromptSuggestions()).toEqual(["第一条建议", "第二条建议"]);
      expect(getAgentPromptSuggestions()).not.toBe(first);
    });
  });
});
