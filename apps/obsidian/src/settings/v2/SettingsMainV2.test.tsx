import type CopilotPlugin from "@/main";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockPanelProps: Record<string, Record<string, unknown>> = {};
jest.mock("@/settings/v2/components/BasicSettings", () => {
  const { useState } = jest.requireActual<typeof import("react")>("react");
  const { useSettingsSubPage } = jest.requireActual<typeof import("@/settings/v2/SettingsSubPage")>(
    "@/settings/v2/SettingsSubPage"
  );
  const MockBasicSettings = (props: Record<string, unknown>) => {
    mockPanelProps.basic = props;
    const { open, close } = useSettingsSubPage();
    const [agentTab, setAgentTab] = useState("OpenCode");
    return (
      <div>
        <button type="button" onClick={() => setAgentTab("Claude")}>
          Agent tab: {agentTab}
        </button>
        <button
          type="button"
          onClick={() =>
            open(
              <button type="button" onClick={close}>
                Back
              </button>
            )
          }
        >
          Edit approved rules
        </button>
      </div>
    );
  };
  return { BasicSettings: MockBasicSettings };
});
jest.mock("@/miyo/settings/MiyoSettings", () => ({
  MiyoSettings: (props: Record<string, unknown>) => {
    mockPanelProps.miyo = props;
    return <div>Miyo settings content</div>;
  },
}));
jest.mock("@/settings/v2/components/SelfHostSettings", () => ({ SelfHostSettings: () => null }));
jest.mock("@/settings/v2/components/CommandSettings", () => ({ CommandSettings: () => null }));
jest.mock("@/settings/v2/components/AdvancedSettings", () => ({
  AdvancedSettings: (props: Record<string, unknown>) => {
    mockPanelProps.advanced = props;
    return null;
  },
}));
jest.mock("@/settings/v2/components/DesktopOnlySettingsPanel", () => ({
  DesktopOnlySettingsPanel: () => null,
}));
const mockSkillManagerRefresh = jest.fn().mockResolvedValue(undefined);
const mockOpenReportIssueModal = jest.fn();
jest.mock("@/agentMode", () => ({
  SkillsSettings: (props: Record<string, unknown>) => {
    mockPanelProps.skills = props;
    return <div>Skills settings content</div>;
  },
  openReportIssueModal: (...args: unknown[]): void => {
    mockOpenReportIssueModal(...args);
  },
}));
jest.mock("@/modelManagement", () => ({
  ByokPanel: () => null,
  ModelManagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { activeBackend: "codex" } }),
  resetSettings: jest.fn(),
}));
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
jest.mock("@/settings/v2/components/ConnectorsSettings", () => ({
  ConnectorsSettings: (props: Record<string, unknown>) => {
    mockPanelProps.connectors = props;
    return null;
  },
}));
let mockConnectorsEnabled: boolean | undefined = true;
jest.mock("@/connectors/connectorsEntitlement", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useIsConnectorsEnabled: () => mockConnectorsEnabled,
}));

const plugin = {
  app: {},
  manifest: { version: "1.2.3" },
  skills: { refresh: mockSkillManagerRefresh },
} as unknown as CopilotPlugin;

function withConnectorsNeedingAttention(needsAttention: boolean): CopilotPlugin {
  const snapshot = { connections: [], waitingLogin: null, failedLogin: null, needsAttention };
  return {
    ...plugin,
    connectionManager: { subscribe: () => () => {}, getSnapshot: () => snapshot },
  } as unknown as CopilotPlugin;
}

describe("SettingsMainV2", () => {
  describe("SettingsMainV2()", () => {
    beforeEach(() => {
      mockSkillLoadErrorCount = 0;
      mockLatestVersion = null;
      mockHasUpdate = false;
      mockConnectorsEnabled = true;
      mockSkillManagerRefresh.mockClear();
      mockOpenReportIssueModal.mockClear();
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
        "Connectors",
        "Commands",
        "Self-Host",
        "Advanced",
      ]);
    });

    it("marks the Skills tab while a skill failed to load for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
      mockSkillLoadErrorCount = 1;

      render(<SettingsMainV2 plugin={plugin} />);

      expect(
        screen.getByRole("tab", { name: "Skills: Some skills failed to load" })
      ).not.toBeNull();
      expect(screen.getByTitle("Some skills failed to load")).not.toBeNull();
    });

    it("marks the Connectors tab with a red dot while a connector needs a login", () => {
      render(<SettingsMainV2 plugin={withConnectorsNeedingAttention(true)} />);

      expect(
        screen.getByRole("tab", {
          name: "Connectors: You have connectors that need your attention",
        })
      ).not.toBeNull();
    });

    it("leaves the Connectors tab unmarked when no connector needs attention or connectors are desktop-only", () => {
      const { unmount } = render(<SettingsMainV2 plugin={withConnectorsNeedingAttention(false)} />);
      expect(screen.getByRole("tab", { name: "Connectors" })).not.toBeNull();
      unmount();

      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.getByRole("tab", { name: "Connectors" })).not.toBeNull();
    });

    it("leaves the Connectors tab unmarked for a user without the connectors preview, who sees the upsell there", () => {
      mockConnectorsEnabled = false;

      render(<SettingsMainV2 plugin={withConnectorsNeedingAttention(true)} />);

      expect(screen.getByRole("tab", { name: "Connectors" })).not.toBeNull();
    });

    it("refreshes hidden Agent repairs when Settings reopens for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      render(<SettingsMainV2 plugin={plugin} />);

      await waitFor(() => expect(mockSkillManagerRefresh).toHaveBeenCalledTimes(1));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 replaces the header, tab strip and tab content with a page a section opens, and Back restores the same tab with its state", () => {
      render(<SettingsMainV2 plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Agent tab: OpenCode" }));

      fireEvent.click(screen.getByRole("button", { name: "Edit approved rules" }));

      expect(screen.getByRole("button", { name: "Back" })).not.toBeNull();
      expect(screen.queryByRole("heading", { name: /Copilot settings/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reset settings" })).toBeNull();
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Agent tab: Claude" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(screen.getByRole("heading", { name: /Copilot settings/ })).not.toBeNull();
      expect(screen.getByRole("tab", { name: "Basic" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("button", { name: "Agent tab: Claude" })).not.toBeNull();
    });

    it("opens on a requested tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<SettingsMainV2 plugin={plugin} initialTab="miyo" />);

      expect(screen.getByRole("tab", { name: "Miyo" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Miyo settings content")).toBeTruthy();
    });

    it("gives the Basic tab's agent settings the plugin's chat manager and manifest", () => {
      const agentSessionManager = { getActiveSession: () => null };
      render(
        <SettingsMainV2 plugin={{ ...plugin, agentSessionManager } as unknown as CopilotPlugin} />
      );

      expect(mockPanelProps.basic.agentSettings).toEqual({
        agentSessionManager,
        manifest: plugin.manifest,
      });
    });

    it("gives the Connectors tab the plugin's connection manager, connector tools and custom connectors", () => {
      const services = {
        connectionManager: withConnectorsNeedingAttention(false).connectionManager,
        connectorTools: { name: "tools" },
        customConnectors: { name: "custom" },
      };
      render(
        <SettingsMainV2
          plugin={{ ...plugin, ...services } as unknown as CopilotPlugin}
          initialTab="connectors"
        />
      );

      expect(mockPanelProps.connectors).toEqual(services);
    });

    it("lets the Miyo tab ask whether the plugin is still loaded at the moment it checks", () => {
      let loaded = true;
      const lifecyclePlugin = {
        ...plugin,
        isPluginLifecycleActive: () => loaded,
      } as unknown as CopilotPlugin;
      render(<SettingsMainV2 plugin={lifecyclePlugin} initialTab="miyo" />);
      const isPluginLifecycleActive = mockPanelProps.miyo.isPluginLifecycleActive as () => boolean;

      expect(isPluginLifecycleActive()).toBe(true);
      loaded = false;
      expect(isPluginLifecycleActive()).toBe(false);
    });

    it("starts the Skills tab's repair chat through the plugin with the draft the panel wrote", async () => {
      const newAgentChatWithDraft = jest.fn().mockResolvedValue(undefined);
      render(
        <SettingsMainV2
          plugin={{ ...plugin, newAgentChatWithDraft } as unknown as CopilotPlugin}
          initialTab="skills"
        />
      );
      await screen.findByText("Skills settings content");

      (mockPanelProps.skills.newAgentChatWithDraft as (draft: string) => void)("Repair my skills");

      expect(newAgentChatWithDraft).toHaveBeenCalledWith("Repair my skills");
    });

    it("opens the issue report from the Advanced tab for the open chat's agent", async () => {
      const reportPlugin = {
        ...plugin,
        agentSessionManager: { getActiveSession: () => ({ backendId: "claude" }) },
      } as unknown as CopilotPlugin;
      render(<SettingsMainV2 plugin={reportPlugin} initialTab="advanced" />);

      (mockPanelProps.advanced.onReportIssue as () => void)();

      await waitFor(() =>
        expect(mockOpenReportIssueModal).toHaveBeenCalledWith(reportPlugin, {
          activeBackend: "claude",
        })
      );
    });

    it("opens the issue report for the default agent when no chat is open", async () => {
      render(<SettingsMainV2 plugin={plugin} initialTab="advanced" />);

      (mockPanelProps.advanced.onReportIssue as () => void)();

      await waitFor(() =>
        expect(mockOpenReportIssueModal).toHaveBeenCalledWith(plugin, { activeBackend: "codex" })
      );
    });
  });
});
