import { AppContext } from "@/context";
import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore, updateSetting } from "@/settings/model";
import { act, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";
import { SkillsSettings } from "./SkillsSettings";

// The manager owns filesystem discovery and a live subscription store; stub the
// singleton so the component renders in isolation while letting us observe the
// refresh triggered by a derived-path change.
const refresh = jest.fn().mockResolvedValue(undefined);
const getAgentDirsProjectRel = jest.fn().mockReturnValue({});
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: { getInstance: () => ({ refresh, getAgentDirsProjectRel }) },
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useManagedSkills: () => [],
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useEpermSeen: () => false,
  dismissEpermBanner: jest.fn(),
}));

// The registry pulls in every backend's icon/adapter chain; the row list is
// empty in these tests, so an empty descriptor set keeps the surface minimal.
jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: () => [],
}));

function renderSettings() {
  return render(
    <AppContext.Provider value={{ vault: { adapter: {} } } as unknown as App}>
      <SkillsSettings />
    </AppContext.Provider>
  );
}

describe("SkillsSettings", () => {
  describe("SkillsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "copilot" });
    });

    it("does not surface a Skills folder settings control (folder is root-derived, not user-editable)", () => {
      renderSettings();
      // The dedicated "Skills folder" setting row was removed: no editable input
      // bound to the retired agentMode.skills.folder field, and no setting row.
      expect(screen.queryByLabelText("Skills folder")).toBeNull();
      expect(screen.queryByText("Skills folder")).toBeNull();
    });

    it("re-derives the discovered folder and re-scans when the Copilot root changes", () => {
      renderSettings();
      // Mount runs one discovery pass; the derived path surfaces in the
      // empty-state hint (there is no folder-setting row).
      expect(screen.getByText(/copilot\/skills/)).not.toBeNull();
      expect(refresh).toHaveBeenCalledTimes(1);

      // No manual rerender: useSettingsValue is a live jotai subscription, so
      // the store update alone must re-render and re-scan. Asserting that here
      // is what locks the reactive contract (a snapshot-only regression fails).
      act(() => {
        updateSetting("copilotFolder", "vault-tools");
      });

      expect(screen.getByText(/vault-tools\/skills/)).not.toBeNull();
      expect(screen.queryByText(/copilot\/skills/)).toBeNull();
      // The discovery pass re-runs so the list reflects the new derived folder;
      // guards against the effect regressing to a stale/retired dependency.
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });
});
