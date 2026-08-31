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

let mockLocale: "en" | "zh-CN" = "en";
let mockLatestVersion: string | null = null;
let mockHasUpdate = false;
jest.mock("@/i18n", () => ({
  t: (key: string, values: Record<string, string> = {}) => {
    const { ENGLISH_TRANSLATIONS } =
      jest.requireActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en");
    const { ZH_CN_TRANSLATIONS } =
      jest.requireActual<typeof import("@/i18n/locales/zh-CN")>("@/i18n/locales/zh-CN");
    const catalog: Readonly<Record<string, string>> =
      mockLocale === "zh-CN" ? ZH_CN_TRANSLATIONS : ENGLISH_TRANSLATIONS;
    return (catalog[key] ?? key).replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
      values[name] === undefined ? placeholder : values[name]
    );
  },
}));

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
      mockSkillManagerRefresh.mockClear();
      mockLocale = "en";
      mockLatestVersion = null;
      mockHasUpdate = false;
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

    it("renders the Simplified Chinese frame while preserving version values for https://github.com/Brevilabs/obsidian-copilot-private/issues/325", () => {
      mockLocale = "zh-CN";
      mockLatestVersion = "9.8.7";
      mockHasUpdate = true;
      mockSkillLoadErrorCount = 1;

      render(<SettingsMainV2 plugin={plugin} />);

      expect(screen.getByRole("heading").textContent).toContain("Copilot 设置");
      expect(screen.getByRole("heading").textContent).toContain("v1.2.3");
      expect(screen.getByRole("link", { name: "（更新到 v9.8.7）" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "重置设置" })).not.toBeNull();
      expect(screen.getByRole("tab", { name: "技能: 部分技能加载失败" })).not.toBeNull();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "基本",
        "BYOK",
        "Miyo",
        "技能",
        "命令",
        "自托管",
        "高级",
      ]);
    });
  });
});
