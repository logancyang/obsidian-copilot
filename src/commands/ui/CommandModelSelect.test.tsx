import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { CommandModelSelect } from "./CommandModelSelect";
describe("CommandModelSelect", () => {
  describe("CommandModelSelect()", () => {
    it("shows Default model and lets the user choose a command-specific model", () => {
      const onChange = jest.fn();
      render(
        <CommandModelSelect
          value=""
          options={[{ label: "GPT-4o", value: "gpt4o" }]}
          onChange={onChange}
        />
      );
      expect(screen.getByDisplayValue("Default model")).not.toBeNull();
      fireEvent.change(screen.getByLabelText("Model (Optional)"), { target: { value: "gpt4o" } });
      expect(onChange).toHaveBeenCalledWith("gpt4o");
    });
  });
});
