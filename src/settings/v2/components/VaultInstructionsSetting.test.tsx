import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("VaultInstructionsSetting", () => {
  describe("VaultInstructionsSetting()", () => {
    it("shows the saved instructions in an editor next to an Open AGENTS.md action", () => {
      render(
        <VaultInstructionsSetting
          value="Cite every source."
          onChange={jest.fn()}
          onOpen={jest.fn()}
        />
      );

      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Custom vault instructions" })
          .value
      ).toBe("Cite every source.");
      expect(screen.getByRole("button", { name: "Open AGENTS.md" })).toBeTruthy();
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
