import { fireEvent, render, screen } from "@testing-library/react";
import { ClaudeAutoModePermissionSetting } from "@/agentMode/backends/claude/ui/ClaudeAutoModePermissionSetting";
import React from "react";

describe("ClaudeAutoModePermissionSetting", () => {
  describe("ClaudeAutoModePermissionSetting()", () => {
    it("shows every supported permission choice and reports the selected value", () => {
      const onChange = jest.fn();
      render(<ClaudeAutoModePermissionSetting value="auto" onChange={onChange} />);

      const selector = screen.getByRole("combobox");
      expect(selector).toEqual(expect.objectContaining({ value: "auto" }));
      expect(screen.getByRole("option", { name: "Auto" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "Accept edits" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "Bypass permissions" })).toBeTruthy();

      fireEvent.change(selector, { target: { value: "acceptEdits" } });

      expect(onChange).toHaveBeenCalledWith("acceptEdits");
    });
  });
});
