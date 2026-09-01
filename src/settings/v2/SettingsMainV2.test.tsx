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
jest.mock("@/settings/v2/components/MiyoSettings", () => ({ MiyoSettings: () => null }));
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
jest.mock("@/hooks/useLatestVersion", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useLatestVersion: () => ({ latestVersion: null, hasUpdate: false }),
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
      mockSkillManagerRefresh.mockClear();
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
  });
});
