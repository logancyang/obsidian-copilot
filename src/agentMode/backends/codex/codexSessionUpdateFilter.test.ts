import { shouldRouteCodexAgentMessageText } from "./codexSessionUpdateFilter";

const PERCENTAGE_WARNING =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
  "Codex can still see every skill, but some descriptions are shorter. " +
  "Disable unused skills or plugins to leave more room for the rest.";
const PERCENTAGE_FREE_WARNING =
  "Warning: Skill descriptions were shortened to fit the skills context budget. " +
  "Codex can still see every skill, but some descriptions are shorter.";

describe("codexSessionUpdateFilter", () => {
  describe("shouldRouteCodexAgentMessageText()", () => {
    it(
      "drops the percentage and percentage-free skills-budget warnings for " +
        "https://github.com/logancyang/obsidian-copilot-preview/issues/315",
      () => {
        expect(shouldRouteCodexAgentMessageText(`${PERCENTAGE_WARNING}\n\n`)).toBe(false);
        expect(shouldRouteCodexAgentMessageText(PERCENTAGE_FREE_WARNING)).toBe(false);
      }
    );

    it(
      "keeps answer text appended to a skills-budget warning for " +
        "https://github.com/logancyang/obsidian-copilot-preview/issues/315",
      () => {
        expect(
          shouldRouteCodexAgentMessageText(
            `${PERCENTAGE_WARNING}\n\nHere is the answer you requested.`
          )
        ).toBe(true);
      }
    );

    it(
      "keeps unrelated warnings and ordinary answers that mention the budget for " +
        "https://github.com/logancyang/obsidian-copilot-preview/issues/315",
      () => {
        expect(shouldRouteCodexAgentMessageText("Warning: Codex login expired.\n\n")).toBe(true);
        expect(
          shouldRouteCodexAgentMessageText(
            "I investigated the skills context budget and found the cause."
          )
        ).toBe(true);
      }
    );
  });
});
