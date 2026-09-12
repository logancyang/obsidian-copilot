import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("VaultInstructionsSetting", () => {
  describe("VaultInstructionsSetting()", () => {
    it("presents the instructions and file action before the editor", () => {
      render(
        <VaultInstructionsSetting
          value="Cite every source."
          onChange={jest.fn()}
          onOpen={jest.fn()}
        />
      );

      const title = screen.getByText("Custom vault instructions");
      const openButton = screen.getByRole("button", { name: "Open AGENTS.md" });
      const editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Custom vault instructions",
      });
      expect(
        title.compareDocumentPosition(openButton) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        openButton.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(editor.value).toBe("Cite every source.");
    });

    it("forwards editor changes and the open action", () => {
      const onChange = jest.fn();
      const onOpen = jest.fn();
      render(<VaultInstructionsSetting value="" onChange={onChange} onOpen={onOpen} />);

      fireEvent.change(screen.getByRole("textbox", { name: "Custom vault instructions" }), {
        target: { value: "Use short filenames." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Open AGENTS.md" }));

      expect(onChange).toHaveBeenCalledWith("Use short filenames.");
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
