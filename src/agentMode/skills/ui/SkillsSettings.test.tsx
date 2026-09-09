import { AppContext } from "@/context";
import { PluginProvider } from "@/contexts/PluginContext";
import { DEFAULT_SETTINGS } from "@/constants";
import type { RejectedSkill, Skill } from "@/agentMode/skills/types";
import { settingsAtom, settingsStore, updateSetting } from "@/settings/model";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { openVaultPath } from "@/utils/openVaultPath";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FileSystemAdapter, TFile, TFolder, type App } from "obsidian";
import React from "react";
import type CopilotPlugin from "@/main";
import type { SkillLoadIssue } from "./SkillLoadIssues";
import { SkillsSettings } from "./SkillsSettings";

// The manager owns filesystem discovery and a live subscription store; stub the
// singleton so the component renders in isolation while letting us observe the
// refresh triggered by a derived-path change.
const setBuiltinSkillEnabled = jest.fn().mockResolvedValue({ ok: true });
const setBuiltinAgentEnabled = jest.fn().mockResolvedValue({ ok: true });
const refresh = jest.fn().mockResolvedValue({ ok: true, reconcileErrorCount: 0 });
const getAgentDirsProjectRel = jest.fn().mockReturnValue({});
let mockManagedSkills: Skill[] = [];
let mockRejectedSkills: RejectedSkill[] = [];
let mockCapturedLoadIssues: readonly SkillLoadIssue[] = [];
let mockCapturedFixAll: () => void = () => undefined;
const mockOpenSkillLoadIssuesModal = jest.fn();
const mockNewAgentChatWithDraft = jest.fn().mockResolvedValue(undefined);
const mockCloseSettings = jest.fn();
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      refresh,
      getAgentDirsProjectRel,
      setBuiltinSkillEnabled,
      setBuiltinAgentEnabled,
    }),
  },
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useManagedSkills: () => mockManagedSkills,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useRejectedSkills: () => mockRejectedSkills,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useEpermSeen: () => false,
  dismissEpermBanner: jest.fn(),
}));

jest.mock("./SkillLoadIssues", () => {
  const actual = jest.requireActual("./SkillLoadIssues");
  return {
    ...actual,
    SkillLoadIssuesModal: class {
      open = mockOpenSkillLoadIssuesModal;

      constructor(_app: App, issues: readonly SkillLoadIssue[], onFixAll: () => void) {
        mockCapturedLoadIssues = issues;
        mockCapturedFixAll = onFixAll;
      }
    },
  };
});

jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));

// The registry pulls in every backend's icon/adapter chain; the row list is
// empty in these tests, so an empty descriptor set keeps the surface minimal.
jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: () => [],
}));

function renderSettings(app: App = makeApp()) {
  const plugin = {
    app,
    newAgentChatWithDraft: mockNewAgentChatWithDraft,
  } as unknown as CopilotPlugin;
  return render(
    <PluginProvider plugin={plugin}>
      <AppContext.Provider value={app}>
        <SkillsSettings />
      </AppContext.Provider>
    </PluginProvider>
  );
}

describe("SkillsSettings", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("SkillsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      __resetVaultBaseCache();
      mockManagedSkills = [];
      mockRejectedSkills = [];
      mockCapturedLoadIssues = [];
      mockCapturedFixAll = () => undefined;
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "copilot" });
    });

    it("keeps disabled catalog rows visible and restores through saved preferences for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const initial = settingsStore.get(settingsAtom);
      settingsStore.set(settingsAtom, {
        ...initial,
        agentMode: {
          ...initial.agentMode,
          skills: {
            ...initial.agentMode.skills,
            builtinPreferences: { "copilot-youtube-transcript": { disabled: true } },
          },
        },
      });
      await act(async () => {
        renderSettings();
      });
      expect(screen.getByRole("table", { name: "Your Skills" })).toBeTruthy();
      expect(screen.getByRole("table", { name: "Built-in Skills" })).toBeTruthy();
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "More actions for copilot-youtube-transcript" }),
        { button: 0, ctrlKey: false }
      );
      const toggle = screen.getByRole("menuitem", { name: "Enable skill" });
      await act(async () => {
        fireEvent.click(toggle);
      });
      expect(setBuiltinSkillEnabled).toHaveBeenCalledWith("copilot-youtube-transcript", true);
    });

    it("shows builtin update failures inline for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      setBuiltinSkillEnabled.mockResolvedValueOnce({
        ok: false,
        message: "Could not remove skill files",
      });
      await act(async () => {
        renderSettings();
      });
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "More actions for copilot-youtube-transcript" }),
        { button: 0, ctrlKey: false }
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Disable skill" }));
      });
      expect(screen.getByRole("alert").textContent).toBe("Could not remove skill files");
    });

    it("filters bundled catalog rows with the shared search for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      await act(async () => {
        renderSettings();
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
        target: { value: "no-such-skill-xyz" },
      });
      expect(
        screen.queryByRole("button", { name: "More actions for copilot-youtube-transcript" })
      ).toBeNull();
      expect(screen.getByText("No built-in skills match your search.")).toBeTruthy();
    });

    it("reports background cleanup failures when settings opens and clears them after focus refresh for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      refresh.mockResolvedValueOnce({
        ok: true,
        reconcileErrorCount: 1,
        reconcileError: "Could not remove disabled built-in skill transcript.",
      });
      await act(async () => {
        renderSettings();
      });
      expect(screen.getByRole("alert").textContent).toBe(
        "Could not remove disabled built-in skill transcript."
      );
      await act(async () => {
        fireEvent.focus(window);
      });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("ignores refresh results after unmount for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      let finish!: (value: unknown) => void;
      refresh.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      const { unmount } = renderSettings();
      unmount();
      await act(async () => {
        finish({ ok: false, reconcileErrorCount: 1, reconcileError: "Late failure" });
      });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("does not surface a Skills folder settings control (folder is root-derived, not user-editable)", async () => {
      await act(async () => {
        renderSettings();
      });
      // The dedicated "Skills folder" setting row was removed: no editable input
      // bound to the retired agentMode.skills.folder field, and no setting row.
      expect(screen.queryByLabelText("Skills folder")).toBeNull();
      expect(screen.queryByText("Skills folder")).toBeNull();
    });

    it("re-derives the discovered folder and re-scans when the Copilot root changes", async () => {
      await act(async () => {
        renderSettings();
      });
      // Mount runs one discovery pass; the derived path surfaces in the
      // empty-state hint (there is no folder-setting row).
      expect(screen.getByText(/copilot\/skills/)).not.toBeNull();
      expect(refresh).toHaveBeenCalledTimes(1);

      // No manual rerender: useSettingsValue is a live jotai subscription, so
      // the store update alone must re-render and re-scan. Asserting that here
      // is what locks the reactive contract (a snapshot-only regression fails).
      await act(async () => {
        updateSetting("copilotFolder", "vault-tools");
      });

      expect(screen.getByText(/vault-tools\/skills/)).not.toBeNull();
      expect(screen.queryByText(/copilot\/skills/)).toBeNull();
      // The discovery pass re-runs so the list reflects the new derived folder;
      // guards against the effect regressing to a stale/retired dependency.
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("refreshes hidden external-editor repairs when Settings regains focus for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      await act(async () => {
        renderSettings();
      });
      expect(refresh).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.focus(window);
      });

      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("shows actionable recovery instead of the creation empty state for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      mockRejectedSkills = [makeRejectedSkill()];
      await act(async () => {
        renderSettings();
      });

      expect(screen.getByRole("alert", { name: "1 skill could not be loaded" })).not.toBeNull();
      expect(screen.getByText("The skills have format errors.")).not.toBeNull();
      expect(screen.getByRole("button", { name: "View details" })).not.toBeNull();
      expect(screen.queryByText("broken-skill")).toBeNull();
      expect(screen.queryByText(".claude/skills/broken-skill/")).toBeNull();
      expect(screen.getByText("0 loaded")).not.toBeNull();
      expect(screen.getByText(/No skills are loaded yet/)).not.toBeNull();
      expect(screen.queryByText("No skills yet")).toBeNull();
    });

    it("opens hidden rejected skills and their folders with system apps for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      mockRejectedSkills = [makeRejectedSkill()];
      await act(async () => {
        renderSettings();
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      expect(mockOpenSkillLoadIssuesModal).toHaveBeenCalledTimes(1);
      expect(mockCapturedLoadIssues[0]).toMatchObject({
        location: ".claude/skills/broken-skill/SKILL.md",
        reason: 'The description contains ": " and must be quoted.',
        offendingText: "description: Use this skill for: reviewing notes",
      });
      mockCapturedLoadIssues[0].onOpen();
      mockCapturedLoadIssues[0].onReveal();

      expect(openVaultPath).toHaveBeenCalledWith(
        expect.anything(),
        "/vault/.claude/skills/broken-skill/SKILL.md",
        { newLeaf: true }
      );
      expect(openWithSystemDefault).toHaveBeenCalledWith("/vault/.claude/skills/broken-skill");
    });

    it("opens review-before-send Agent drafts for one or all rejected skills for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      mockRejectedSkills = [
        makeRejectedSkill(),
        makeRejectedSkill({
          filePath: "/vault/.codex/skills/second/SKILL.md",
          dirPath: "/vault/.codex/skills/second",
          reason: "Missing name.",
          offendingText: undefined,
        }),
      ];
      await act(async () => {
        renderSettings();
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      mockCapturedLoadIssues[0].onFixWithAgent();
      mockCapturedFixAll();

      expect(mockCloseSettings).toHaveBeenCalledTimes(2);
      expect(mockNewAgentChatWithDraft).toHaveBeenCalledTimes(2);
      expect(mockNewAgentChatWithDraft.mock.calls[0][0]).toContain(
        'File: ".claude/skills/broken-skill/SKILL.md"'
      );
      expect(mockNewAgentChatWithDraft.mock.calls[0][0]).not.toContain("Change to");
      expect(mockNewAgentChatWithDraft.mock.calls[1][0]).toContain(
        'File: ".codex/skills/second/SKILL.md"'
      );
    });

    it("opens and reveals indexed rejected skills inside Obsidian for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      const app = makeApp(true);
      mockRejectedSkills = [
        makeRejectedSkill({
          filePath: "/vault/copilot/skills/broken-skill/SKILL.md",
          dirPath: "/vault/copilot/skills/broken-skill",
        }),
      ];
      await act(async () => {
        renderSettings(app);
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      mockCapturedLoadIssues[0].onOpen();
      mockCapturedLoadIssues[0].onReveal();

      expect(openVaultPath).toHaveBeenCalledWith(
        app,
        "/vault/copilot/skills/broken-skill/SKILL.md",
        { newLeaf: true }
      );
      expect(
        (
          app as unknown as {
            internalPlugins: {
              getPluginById: () => { instance: { revealInFolder: jest.Mock } };
            };
          }
        ).internalPlugins.getPluginById().instance.revealInFolder
      ).toHaveBeenCalledTimes(1);
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("reveals vault-relative rejected skills inside Obsidian when no absolute vault path exists for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      const app = makeApp(true);
      mockRejectedSkills = [
        makeRejectedSkill({
          filePath: "copilot/skills/broken-skill/SKILL.md",
          dirPath: "copilot/skills/broken-skill",
        }),
      ];
      await act(async () => {
        renderSettings(app);
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      mockCapturedLoadIssues[0].onReveal();

      expect(
        (
          app as unknown as {
            internalPlugins: {
              getPluginById: () => { instance: { revealInFolder: jest.Mock } };
            };
          }
        ).internalPlugins.getPluginById().instance.revealInFolder
      ).toHaveBeenCalledTimes(1);
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });
  });
});

function makeApp(indexRejectedSkill = false): App {
  const file = new (TFile as unknown as new (path: string) => TFile)(
    "copilot/skills/broken-skill/SKILL.md"
  );
  const folder = new (TFolder as unknown as new (path: string) => TFolder)(
    "copilot/skills/broken-skill"
  );
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
    "/vault"
  );
  const revealInFolder = jest.fn();
  return {
    vault: {
      adapter,
      getAbstractFileByPath: jest.fn((path: string) => {
        if (!indexRejectedSkill) return null;
        if (path.endsWith("/SKILL.md")) return file;
        if (path === "copilot/skills/broken-skill") return folder;
        return null;
      }),
    },
    workspace: {
      openLinkText: jest.fn(),
    },
    setting: {
      close: mockCloseSettings,
    },
    internalPlugins: {
      getPluginById: jest.fn(() => ({ enabled: true, instance: { revealInFolder } })),
    },
  } as unknown as App;
}

function makeRejectedSkill(overrides: Partial<RejectedSkill> = {}): RejectedSkill {
  return {
    name: "broken-skill",
    filePath: "/vault/.claude/skills/broken-skill/SKILL.md",
    dirPath: "/vault/.claude/skills/broken-skill",
    reason: 'The description contains ": " and must be quoted.',
    offendingText: "description: Use this skill for: reviewing notes",
    ...overrides,
  };
}
