import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("InstructionsTextarea", () => {
  describe("InstructionsTextarea()", () => {
    it("shows an example placeholder while empty and the current text once instructions exist", () => {
      const props = { onChange: jest.fn(), label: "Instructions" };
      const { rerender } = render(<InstructionsTextarea {...props} value="" />);
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Instructions" });
      expect(textarea.placeholder).toBe(
        "e.g. Put new notes you create in Inbox/ and link them to a related note."
      );

      rerender(<InstructionsTextarea {...props} value="My rules" />);
      expect(textarea.value).toBe("My rules");
    });

    it("reports what the user typed", () => {
      const onChange = jest.fn();
      render(<InstructionsTextarea value="" onChange={onChange} label="Instructions" />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cite every source." } });
      expect(onChange).toHaveBeenCalledWith("Cite every source.");
    });
  });
});
