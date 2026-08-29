import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelEffortPicker } from "./ModelEffortPicker";

describe("ModelEffortPicker", () => {
  describe("ModelEffortPicker()", () => {
    it("keeps a disabled loading model selected until the user chooses an alternative (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const commitSelection = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models: [
              {
                name: "copilot-plus/copilot-plus-flash",
                provider: "agent",
                displayName: "Copilot Plus Flash",
                enabled: true,
                _backendId: "opencode",
                _group: "opencode",
                _disabledReason: "Loading…",
              },
              {
                name: "openai/gpt-5",
                provider: "agent",
                displayName: "GPT-5",
                enabled: true,
                _backendId: "opencode",
                _group: "opencode",
              },
            ],
            value: "opencode:copilot-plus/copilot-plus-flash|agent",
            effortOptionsByModelKey: {},
            commitSelection,
          }}
        />
      );

      expect(screen.getByRole("button").textContent).toContain("Loading…");
      fireEvent.click(screen.getByRole("button"));
      expect(await screen.findByText("GPT-5")).toBeTruthy();
      fireEvent.click(screen.getByRole("button"));

      expect(commitSelection).not.toHaveBeenCalled();
    });
  });
});
