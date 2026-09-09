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
        saveBuiltinPreferences((current) => ({ ...current, first: { disabled: true } }), jest.fn()),
        saveBuiltinPreferences(
          (current) => ({ ...current, second: { disabledAgents: ["opencode"] } }),
          jest.fn()
        ),
      ]);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        first: { disabled: true },
        second: { disabledAgents: ["opencode"] },
      });
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toEqual(
        getSettings().agentMode.skills.builtinPreferences
      );
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

    it("leaves preferences unchanged when persistence fails (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      persist.mockRejectedValue(new Error("disk full"));
      await expect(
        saveBuiltinPreferences(() => ({ "copilot-web-search": { disabled: true } }), jest.fn())
      ).rejects.toThrow("disk full");
      expect(getSettings().agentMode.skills.builtinPreferences).toBeUndefined();
    });
  });
});
