import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("VaultInstructionsSetting", () => {
  describe("VaultInstructionsSetting()", () => {
    it("places the file action beside the description and the full-width editor underneath", () => {
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
      const headerRow = title.parentElement?.parentElement;

      expect(headerRow).not.toBeNull();
      expect(headerRow?.contains(openButton)).toBe(true);
      expect(headerRow?.contains(editor)).toBe(false);
      expect(editor.parentElement).toBe(headerRow?.parentElement);
      expect(editor.classList.contains("tw-w-full")).toBe(true);
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
