import { MemorySaveLine, type MemorySaveLineProps } from "@/agents/agentMode/ui/MemorySaveLine";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const MEMORY_PATH = "copilot/teammates/coco/MEMORY.md";
const RULE = "Launch videos lead with user value, not the feature list.";

function renderLine(props: Partial<MemorySaveLineProps> = {}) {
  const onOpen = jest.fn();
  const onOpenInstruction = jest.fn();
  render(
    <MemorySaveLine
      agentName="Coco"
      memoryPath={MEMORY_PATH}
      rule={RULE}
      onOpen={onOpen}
      onOpenInstruction={onOpenInstruction}
      {...props}
    />
  );
  return { onOpen, onOpenInstruction, header: screen.getByRole("button", { name: /^Coco/ }) };
}

describe("MemorySaveLine", () => {
  describe("MemorySaveLine", () => {
    it("says the teammate remembered and quotes the saved rule on the closed card's header, cut with an ellipsis when long", () => {
      const { header } = renderLine();

      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByText("Coco remembered")).toBeTruthy();
      expect(screen.getByText(`“${RULE}”`).className).toContain("tw-truncate");
      expect(screen.queryByRole("button", { name: `Open ${MEMORY_PATH}` })).toBeNull();
    });

    it("opens from its header to show the full rule and a row that opens MEMORY.md, whose tooltip is the file's path, and offers no Undo", () => {
      const { onOpen, header } = renderLine();

      fireEvent.click(header);
      const row = screen.getByRole("button", { name: `Open ${MEMORY_PATH}` });
      fireEvent.click(row);

      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText(RULE)).toBeTruthy();
      expect(row.textContent).toBe("MEMORYcopilot/teammates/coco");
      expect(row.getAttribute("title")).toBe(MEMORY_PATH);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/undo/i)).toBeNull();
    });

    it("starts open when asked to", () => {
      renderLine({ defaultOpen: true });

      expect(screen.getByRole("button", { name: `Open ${MEMORY_PATH}` })).toBeTruthy();
    });

    it("says the teammate replaced a rule and, once opened, shows the old rule struck through above the new one", () => {
      const { header } = renderLine({
        rule: "Write summaries as short paragraphs, no bullet points.",
        replaced: "Summarize as bullet points.",
      });

      fireEvent.click(header);

      expect(screen.getByText("Coco replaced a rule")).toBeTruthy();
      expect(screen.queryByText("Coco remembered")).toBeNull();
      const old = screen.getByText("Summarize as bullet points.");
      expect(old.className).toContain("tw-line-through");
      expect(
        old.compareDocumentPosition(
          screen.getByText("Write summaries as short paragraphs, no bullet points.")
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("warns on the closed card, quoting the instruction sentence, when the rule goes against the instruction, and opens the instruction from its link alone", () => {
      const { onOpen, onOpenInstruction, header } = renderLine({
        rule: "Taxes are Leo's job now. Point tax questions to Leo.",
        contradicts: "File quarterly estimated taxes.",
      });

      expect(
        screen.getByText(
          /Goes against what Coco handles: “File quarterly estimated taxes\.” This rule wins for now\./
        )
      ).toBeTruthy();
      fireEvent.click(screen.getByText("Open instruction"));

      expect(onOpenInstruction).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("shows no warning for a rule that agrees with the instruction", () => {
      renderLine();

      expect(screen.queryByText("Open instruction")).toBeNull();
    });
  });
});
