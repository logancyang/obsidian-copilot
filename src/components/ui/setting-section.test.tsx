import { render, screen } from "@testing-library/react";
import React from "react";
import { SettingSection } from "./setting-section";

describe("setting-section", () => {
  describe("SettingSection()", () => {
    it("renders the section title larger than its supporting description", () => {
      render(
        <SettingSection label="Index scope" description="Which notes Copilot searches.">
          <div>Settings</div>
        </SettingSection>
      );

      expect(screen.getByText("Index scope").className).toContain("tw-text-sm");
      expect(screen.getByText("Which notes Copilot searches.").className).toContain("tw-text-xs");
    });
  });
});
