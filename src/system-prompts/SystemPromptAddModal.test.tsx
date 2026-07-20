import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { SystemPromptAddModalContent } from "@/system-prompts/SystemPromptAddModal";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("SystemPromptAddModal", () => {
  // The banner under test never touches `contentEl` (only the disabled template
  // popover would), so a bare stub keeps the render free of DOM-global lint.
  const contentEl = {} as unknown as HTMLElement;
  const renderContent = () =>
    render(
      <SystemPromptAddModalContent
        prompts={[]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        contentEl={contentEl}
      />
    );

  describe("SystemPromptAddModalContent", () => {
    beforeEach(() => {
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
    });

    it("shows the system-prompts folder derived from the default root", () => {
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "copilot" });
      renderContent();
      expect(screen.getByText("copilot/system-prompts")).toBeTruthy();
    });

    it("shows the system-prompts folder derived from a custom root after a root change", () => {
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "team-ai" });
      renderContent();
      expect(screen.getByText("team-ai/system-prompts")).toBeTruthy();
      // Guards the F4 fix: the banner must not fall back to the retired flat field.
      expect(screen.queryByText("copilot/system-prompts")).toBeNull();
    });
  });
});
