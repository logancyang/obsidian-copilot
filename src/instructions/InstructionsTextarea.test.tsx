import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("InstructionsTextarea", () => {
  describe("InstructionsTextarea()", () => {
    it("shows a fixed example immediately and after instructions are cleared", () => {
      jest.useFakeTimers();
      try {
        const props = { onChange: jest.fn(), label: "Instructions" };
        const { rerender } = render(<InstructionsTextarea {...props} value="" />);
        const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Instructions" });
        const example = "e.g. Put new notes you create in Inbox/ and link them to a related note.";
        expect(textarea.placeholder).toBe(example);
        act(() => jest.advanceTimersByTime(30_000));
        expect(textarea.placeholder).toBe(example);
        expect(jest.getTimerCount()).toBe(0);

        rerender(<InstructionsTextarea {...props} value="My rules" />);
        expect(textarea.value).toBe("My rules");
        rerender(<InstructionsTextarea {...props} value="" />);
        expect(textarea.placeholder).toBe(example);
      } finally {
        jest.useRealTimers();
      }
    });

    it("reports what the user typed", () => {
      const onChange = jest.fn();
      render(<InstructionsTextarea value="" onChange={onChange} label="Instructions" />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cite every source." } });
      expect(onChange).toHaveBeenCalledWith("Cite every source.");
    });
  });
});
