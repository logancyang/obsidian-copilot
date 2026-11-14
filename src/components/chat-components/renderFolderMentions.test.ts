import { renderFolderMentions } from "@/components/chat-components/renderFolderMentions";

function rendered(text: string, tag = "p"): HTMLElement {
  const container = document.createElement("div");
  const element = document.createElement(tag);
  element.textContent = text;
  container.appendChild(element);
  document.body.appendChild(container);
  return container;
}

const pills = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("span")).map((span) => span.textContent);

describe("renderFolderMentions", () => {
  describe("renderFolderMentions()", () => {
    it("leaves a message that mentions none of its folders as rendered", () => {
      const container = rendered("Compare the notes");

      renderFolderMentions(container, ["Research"]);

      expect(container.innerHTML).toBe("<p>Compare the notes</p>");
    });

    it("draws each mentioned folder as a pill and keeps the surrounding text (https://github.com/Brevilabs/obsidian-copilot-private/issues/932)", () => {
      const container = rendered("Compare {Research} with {Research/Pricing} today");

      renderFolderMentions(container, ["Research", "Research/Pricing"]);

      expect(pills(container)).toEqual(["{Research}", "{Research/Pricing}"]);
      expect(container.textContent).toBe("Compare {Research} with {Research/Pricing} today");
    });

    it("keeps a folder mention inside code as typed (https://github.com/Brevilabs/obsidian-copilot-private/issues/932)", () => {
      const container = rendered("{Research}", "code");

      renderFolderMentions(container, ["Research"]);

      expect(pills(container)).toEqual([]);
    });
  });
});
