import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelSettingsButton } from "./model-settings-button";

describe("model-settings-button", () => {
  describe("ModelSettingsButton()", () => {
    it("offers to configure the default model when the dialog already has a model", () => {
      render(<ModelSettingsButton needsModel={false} onClick={() => undefined} />);
      expect(screen.getByRole("button", { name: "Configure the default model" })).not.toBeNull();
    });
    it("flags a missing model so the user knows to open settings (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      render(<ModelSettingsButton needsModel onClick={() => undefined} />);
      const button = screen.getByRole("button", { name: "A model must be selected" });
      expect(button.querySelector(".tw-bg-warning")).not.toBeNull();
    });
    it("reports the window that owns the clicked button", () => {
      const onClick = jest.fn();
      render(<ModelSettingsButton needsModel={false} onClick={onClick} />);
      fireEvent.click(screen.getByRole("button"));
      expect(onClick).toHaveBeenCalledWith(window);
    });
  });
});
