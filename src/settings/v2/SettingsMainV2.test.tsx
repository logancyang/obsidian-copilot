/**
 * Locks the tab strip's shape. `Record<TabId, …>` only forces the four
 * registration sites to agree with each other — it says nothing about which tabs
 * exist or what order they appear in, so folding Agents into Basic or reordering
 * the strip can be undone without a single type error.
 */

import type CopilotPlugin from "@/main";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { requestSettingsDeepLink } from "@/settings/v2/settingsSearch";
import { act, render, screen } from "@testing-library/react";
import React from "react";

// Every tab body is stubbed empty. The real panels reach for the keychain, Node,
// and the network, none of which has any bearing on the strip above them. The
// Advanced stub renders one anchored row so deep-link scrolling is observable.
jest.mock("@/settings/v2/components/BasicSettings", () => ({ BasicSettings: () => null }));
jest.mock("@/settings/v2/components/MiyoSettings", () => ({ MiyoSettings: () => null }));
jest.mock("@/settings/v2/components/SelfHostSettings", () => ({ SelfHostSettings: () => null }));
jest.mock("@/settings/v2/components/CommandSettings", () => ({ CommandSettings: () => null }));
jest.mock("@/settings/v2/components/AdvancedSettings", () => ({
  AdvancedSettings: () => <div data-copilot-setting="debug-mode" data-testid="debug-mode-row" />,
}));
jest.mock("@/settings/v2/components/DesktopOnlySettingsPanel", () => ({
  DesktopOnlySettingsPanel: () => null,
}));
jest.mock("@/agentMode", () => ({ SkillsSettings: () => null }));
jest.mock("@/modelManagement", () => ({
  ByokPanel: () => null,
  ModelManagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/settings/model", () => ({ resetSettings: jest.fn() }));
jest.mock("@/hooks/useLatestVersion", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useLatestVersion: () => ({ latestVersion: null, hasUpdate: false }),
}));

const plugin = { app: {}, manifest: { version: "1.2.3" } } as unknown as CopilotPlugin;

describe("SettingsMainV2", () => {
  describe("SettingsMainV2()", () => {
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

    it("switches to the deep-linked tab and scrolls its anchored row into view", () => {
      const scrollIntoView = jest.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
      render(<SettingsMainV2 plugin={plugin} />);

      act(() => {
        requestSettingsDeepLink({ tabId: "advanced", anchor: "debug-mode" });
      });

      expect(screen.getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe(
        "true"
      );
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(screen.getByTestId("debug-mode-row").classList.contains("is-flashing")).toBe(true);
    });

    it("still switches tabs when the deep-linked anchor is absent from the tab", () => {
      render(<SettingsMainV2 plugin={plugin} />);

      act(() => {
        requestSettingsDeepLink({ tabId: "command", anchor: "not-rendered" });
      });

      expect(screen.getByRole("tab", { name: "Command" }).getAttribute("aria-selected")).toBe(
        "true"
      );
    });

    it("applies a deep link buffered before the settings UI mounted", () => {
      requestSettingsDeepLink({ tabId: "selfhost", anchor: "enable-self-host-mode" });

      render(<SettingsMainV2 plugin={plugin} />);

      expect(screen.getByRole("tab", { name: "Self-Host" }).getAttribute("aria-selected")).toBe(
        "true"
      );
    });
  });
});
