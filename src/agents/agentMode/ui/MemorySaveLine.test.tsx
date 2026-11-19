import { MemorySaveLine, type MemorySaveLineProps } from "@/agents/agentMode/ui/MemorySaveLine";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const MEMORY_PATH = "copilot/agents/coco/MEMORY.md";

function renderLine(props: Partial<MemorySaveLineProps> = {}) {
  const onOpen = jest.fn();
  const onOpenInstruction = jest.fn();
  render(
    <MemorySaveLine
      agentName="Coco"
      memoryPath={MEMORY_PATH}
      rule="Launch videos lead with user value, not the feature list."
      onOpen={onOpen}
      onOpenInstruction={onOpenInstruction}
      {...props}
    />
  );
  return { onOpen, onOpenInstruction };
}

describe("MemorySaveLine", () => {
  describe("MemorySaveLine", () => {
    it("says the agent remembered and quotes the saved rule word for word", () => {
      renderLine();

      expect(screen.getByText("Coco remembered")).toBeTruthy();
      expect(
        screen.getByText("“Launch videos lead with user value, not the feature list.”")
      ).toBeTruthy();
    });

    it("opens MEMORY.md from anywhere on the row, whose tooltip is the file's path, and offers no Undo", () => {
      const { onOpen } = renderLine();
      const row = screen.getByRole("button", { name: `Open ${MEMORY_PATH}` });

      fireEvent.click(row);

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(row.getAttribute("title")).toBe(MEMORY_PATH);
      expect(screen.getByText("Open")).toBeTruthy();
      expect(screen.queryByText(/undo/i)).toBeNull();
    });

    it("says the agent replaced a rule and shows the old rule struck through above the new one", () => {
      renderLine({
        rule: "Write summaries as short paragraphs, no bullet points.",
        replaced: "Summarize as bullet points.",
      });

      expect(screen.getByText("Coco replaced a rule")).toBeTruthy();
      expect(screen.queryByText("Coco remembered")).toBeNull();
      const old = screen.getByText("Summarize as bullet points.");
      expect(old.className).toContain("tw-line-through");
      expect(
        old.compareDocumentPosition(
          screen.getByText("“Write summaries as short paragraphs, no bullet points.”")
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("warns, quoting the instruction sentence, when the rule goes against the instruction, and opens the instruction from its link alone", () => {
      const { onOpen, onOpenInstruction } = renderLine({
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
    });

    it("shows no warning for a rule that agrees with the instruction", () => {
      renderLine();

      expect(screen.queryByText("Open instruction")).toBeNull();
    });
  });
});
