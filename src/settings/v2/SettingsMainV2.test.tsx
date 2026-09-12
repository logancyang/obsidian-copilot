/**
 * Locks the tab strip's shape. `Record<TabId, …>` only forces the four
 * registration sites to agree with each other — it says nothing about which tabs
 * exist or what order they appear in, so folding Agents into Basic or reordering
 * the strip can be undone without a single type error.
 */

import type CopilotPlugin from "@/main";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Every tab body is stubbed empty. The real panels reach for the keychain, Node,
// and the network, none of which has any bearing on the strip above them.
jest.mock("@/settings/v2/components/BasicSettings", () => ({ BasicSettings: () => null }));
jest.mock("@/settings/v2/components/MiyoSettings", () => ({
  MiyoSettings: () => <div>Miyo settings content</div>,
}));
jest.mock("@/settings/v2/components/SelfHostSettings", () => ({ SelfHostSettings: () => null }));
jest.mock("@/settings/v2/components/CommandSettings", () => ({ CommandSettings: () => null }));
jest.mock("@/settings/v2/components/AdvancedSettings", () => ({ AdvancedSettings: () => null }));
jest.mock("@/settings/v2/components/DesktopOnlySettingsPanel", () => ({
  DesktopOnlySettingsPanel: () => null,
}));
const mockSkillManagerRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock("@/agentMode", () => ({
  SkillsSettings: () => null,
}));
jest.mock("@/modelManagement", () => ({
  ByokPanel: () => null,
  ModelManagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/settings/model", () => ({ resetSettings: jest.fn() }));
let mockSkillLoadErrorCount = 0;
jest.mock("@/settings/skillLoadErrorState", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useSkillLoadErrorCount: () => mockSkillLoadErrorCount,
}));
let mockLatestVersion: string | null = null;
let mockHasUpdate = false;
jest.mock("@/hooks/useLatestVersion", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useLatestVersion: () => ({ latestVersion: mockLatestVersion, hasUpdate: mockHasUpdate }),
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => true }));

const plugin = {
  app: {},
  manifest: { version: "1.2.3" },
  skills: { refresh: mockSkillManagerRefresh },
} as unknown as CopilotPlugin;

describe("SettingsMainV2", () => {
  describe("SettingsMainV2()", () => {
    beforeEach(() => {
      mockSkillLoadErrorCount = 0;
      mockLatestVersion = null;
      mockHasUpdate = false;
      mockSkillManagerRefresh.mockClear();
    });

    it("shows the installed version and latest version from the shared update hook", () => {
      mockLatestVersion = "4.1.0";
      mockHasUpdate = true;
      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.getByText("v1.2.3")).toBeTruthy();
      expect(screen.getByRole("link", { name: "(Update to v4.1.0)" })).toBeTruthy();
    });

    it("shows up to date when the shared check finds no newer release", () => {
      mockLatestVersion = "1.2.3";
      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.getByText("(up to date)")).toBeTruthy();
    });

    it("lists the tabs in the agreed order", () => {
      render(<SettingsMainV2 plugin={plugin} />);

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Basic",
        "BYOK",
        "Miyo",
        "Skills",
        "Command",
        "Self-Host",
        "Advanced",
      ]);
    });

    it("offers no Agents tab, because agent settings live on the Basic tab", () => {
      render(<SettingsMainV2 plugin={plugin} />);

      expect(screen.queryByRole("tab", { name: /agents/i })).toBeNull();
    });

    it("marks the Skills tab while a skill failed to load for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
      mockSkillLoadErrorCount = 1;

      render(<SettingsMainV2 plugin={plugin} />);

      expect(
        screen.getByRole("tab", { name: "Skills: Some skills failed to load" })
      ).not.toBeNull();
      expect(screen.getByTitle("Some skills failed to load")).not.toBeNull();
    });

    it("refreshes hidden Agent repairs when Settings reopens for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      render(<SettingsMainV2 plugin={plugin} />);

      await waitFor(() => expect(mockSkillManagerRefresh).toHaveBeenCalledTimes(1));
    });

    it("opens on a requested tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<SettingsMainV2 plugin={plugin} initialTab="miyo" />);

      expect(screen.getByRole("tab", { name: "Miyo" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Miyo settings content")).toBeTruthy();
    });
  });
});
