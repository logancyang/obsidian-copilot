import { agentMentionOptions } from "@/agents/ui/agentMentionOptions";
import { LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import { render } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";

describe("agentMentionOptions", () => {
  describe("agentMentionOptions()", () => {
    it("lists each agent with its name, title and face, ready to become a mention pill", () => {
      const [option] = agentMentionOptions([MAYA], "");

      expect(option).toMatchObject({
        title: "Maya",
        subtitle: "Product critic. Pushes back on plans",
        category: "customAgent",
        data: "maya",
      });
      const { container } = render(<>{option.icon}</>);
      expect(container.querySelector("img")?.getAttribute("src")).toBe(MAYA.faceSrc);
    });

    it(`keeps only agents whose name holds the typed text, in any case (${ISSUE})`, () => {
      expect(agentMentionOptions([MAYA, LEO, NORA], "LE").map((option) => option.title)).toEqual([
        "Leo",
      ]);
    });

    it("lists an agent made without a title by its name alone", () => {
      const [option] = agentMentionOptions([{ ...LEO, title: "" }], "");

      expect(option.subtitle).toBeUndefined();
    });
    it(`marks each agent locked, with a greyed face, while custom agents are locked (${LOCKED_ISSUE})`, () => {
      const [option] = agentMentionOptions([MAYA], "", () => "Supporter preview");

      expect(option).toMatchObject({ title: "Maya", lockedNote: "Supporter preview" });
      const { container } = render(<>{option.icon}</>);
      expect(container.querySelector("img")?.className).toContain("tw-grayscale");
      expect(agentMentionOptions([MAYA], "")[0].lockedNote).toBeUndefined();
    });

    it("locks only the agents its note names, as an agent whose model can't run on this device, for https://github.com/Brevilabs/obsidian-copilot-private/issues/962", () => {
      const options = agentMentionOptions([MAYA, LEO], "", (agent) =>
        agent.slug === LEO.slug ? "Needs setup" : undefined
      );

      expect(options.map((option) => option.lockedNote)).toEqual([undefined, "Needs setup"]);
    });
  });
});
