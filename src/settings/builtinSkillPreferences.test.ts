import { DEFAULT_SETTINGS } from "@/constants";
import { saveBuiltinPreferences } from "@/settings/builtinSkillPreferences";
import {
  getSettings,
  setSettings,
  settingsAtom,
  settingsStore,
  type CopilotSettings,
} from "@/settings/model";

const persist = jest.fn<Promise<void>, [CopilotSettings]>();
let inTransaction = false;
jest.mock("@/services/settingsPersistence", () => ({
  runPersistenceTransaction: async (task: () => Promise<void>) => {
    inTransaction = true;
    try {
      await task();
    } finally {
      inTransaction = false;
    }
  },
  persistSettingsWithinTransaction: (settings: CopilotSettings) => persist(settings),
}));

describe("builtinSkillPreferences", () => {
  describe("saveBuiltinPreferences()", () => {
    it("merges concurrent updater saves instead of losing the first opt-out https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      await Promise.all([
        saveBuiltinPreferences(
          (current) => ({ ...current, "copilot-web-search": { disabled: true } }),
          jest.fn()
        ),
        saveBuiltinPreferences(
          (current) => ({ ...current, "copilot-web-fetch": { disabledAgents: ["opencode"] } }),
          jest.fn()
        ),
      ]);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        "copilot-web-search": { disabled: true },
        "copilot-web-fetch": { disabledAgents: ["opencode"] },
      });
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toEqual(
        getSettings().agentMode.skills.builtinPreferences
      );
    });
    it("preserves untouched preference objects when saving another skill https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      await saveBuiltinPreferences(
        () => ({ "copilot-web-search": { disabledAgents: ["codex"] } }),
        jest.fn()
      );
      const previous = getSettings().agentMode.skills.builtinPreferences!["copilot-web-search"];
      await saveBuiltinPreferences(
        (current) => ({ ...current, "copilot-web-fetch": { disabled: true } }),
        jest.fn()
      );
      expect(getSettings().agentMode.skills.builtinPreferences!["copilot-web-search"]).toBe(
        previous
      );
      expect(getSettings().agentMode.skills.builtinPreferences!["copilot-web-fetch"]).toEqual({
        disabled: true,
      });
    });
    beforeEach(() => {
      jest.clearAllMocks();
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
      persist.mockResolvedValue(undefined);
    });

    it("activates opt-outs only after the durable transaction exits (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      const preferences = { "copilot-web-search": { disabled: true } };
      persist.mockImplementation(async (settings) => {
        expect(inTransaction).toBe(true);
        expect(settings.agentMode.skills.builtinPreferences).toEqual(preferences);
        expect(getSettings().agentMode.skills.builtinPreferences).toBeUndefined();
      });
      const onActivation = jest.fn(() => expect(inTransaction).toBe(false));
      const unsubscribe = settingsStore.sub(settingsAtom, onActivation);
      try {
        await saveBuiltinPreferences(() => preferences, jest.fn());
        expect(getSettings().agentMode.skills.builtinPreferences).toEqual(preferences);
        expect(onActivation).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
      }
    });

    it("preserves settings edits made during the write (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      persist.mockImplementation(async () => {
        setSettings((current) => ({
          debug: true,
          agentMode: {
            ...current.agentMode,
            skills: { ...current.agentMode.skills, suppressMigrationConfirm: true },
          },
        }));
      });
      await saveBuiltinPreferences(
        () => ({ "copilot-web-search": { disabledAgents: ["opencode"] } }),
        jest.fn()
      );
      expect(getSettings().debug).toBe(true);
      expect(getSettings().agentMode.skills.suppressMigrationConfirm).toBe(true);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        "copilot-web-search": { disabledAgents: ["opencode"] },
      });
    });

    it("persists, activates, and returns empty preferences when restoring defaults https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      await saveBuiltinPreferences(
        () => ({ "copilot-web-search": { disabled: true, disabledAgents: ["opencode"] } }),
        jest.fn()
      );
      const preferences = await saveBuiltinPreferences(
        () => ({ "copilot-web-search": { disabled: false, disabledAgents: [] } }),
        jest.fn()
      );
      expect(preferences).toEqual({});
      expect(getSettings().agentMode.skills.builtinPreferences).toBe(preferences);
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toBe(preferences);
    });

    it("continues queued saves after a failed write without committing the failed opt-out https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      persist.mockRejectedValueOnce(new Error("disk full"));
      const results = await Promise.allSettled([
        saveBuiltinPreferences(
          (current) => ({ ...current, "copilot-web-search": { disabled: true } }),
          jest.fn()
        ),
        saveBuiltinPreferences(
          (current) => ({ ...current, "copilot-web-fetch": { disabledAgents: ["codex"] } }),
          jest.fn()
        ),
      ]);
      expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        "copilot-web-fetch": { disabledAgents: ["codex"] },
      });
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toEqual(
        getSettings().agentMode.skills.builtinPreferences
      );
    });

    it("leaves preferences unchanged when persistence fails (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      persist.mockRejectedValue(new Error("disk full"));
      await expect(
        saveBuiltinPreferences(() => ({ "copilot-web-search": { disabled: true } }), jest.fn())
      ).rejects.toThrow("disk full");
      expect(getSettings().agentMode.skills.builtinPreferences).toBeUndefined();
    });
  });
});
