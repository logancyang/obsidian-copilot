import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { QuickCommandModelSetting } from "./QuickCommandModelSetting";

describe("QuickCommandModelSetting", () => {
  describe("QuickCommandModelSetting()", () => {
    it("shows the saved default and publishes a newly selected model", () => {
      const onChange = jest.fn();
      render(
        <QuickCommandModelSetting
          value="a"
          options={[
            { label: "Model A", value: "a" },
            { label: "Model B", value: "b" },
          ]}
          onChange={onChange}
        />
      );
      expect(screen.getByDisplayValue("Model A")).not.toBeNull();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
      expect(onChange).toHaveBeenCalledWith("b");
    });
    it("asks for a choice when no default is available (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      render(
        <QuickCommandModelSetting
          value={undefined}
          options={[{ label: "Model A", value: "a" }]}
          onChange={() => undefined}
        />
      );
      expect(screen.getByDisplayValue("Select Model")).not.toBeNull();
    });
  });
});
