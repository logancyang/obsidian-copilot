import {
  getSettings,
  sanitizeBuiltinPreferences,
  setSettings,
  type CopilotSettings,
} from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
} from "@/services/settingsPersistence";

export type BuiltinPreferences = NonNullable<
  CopilotSettings["agentMode"]["skills"]["builtinPreferences"]
>;
export type BuiltinPreferencesUpdate = (current: BuiltinPreferences) => BuiltinPreferences;
const EMPTY_PREFERENCES: BuiltinPreferences = Object.freeze({});
// Serialize through activation too: a second updater must see the first durable choice
// in memory before deriving its write. https://github.com/logancyang/obsidian-copilot/issues/3022
let preferenceWrites: Promise<void> = Promise.resolve();

export async function saveBuiltinPreferences(
  update: BuiltinPreferencesUpdate,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<BuiltinPreferences> {
  const result = preferenceWrites.then(async () => {
    let preferences: BuiltinPreferences = EMPTY_PREFERENCES;
    await runPersistenceTransaction(async () => {
      const previous = getSettings();
      const current = previous.agentMode.skills.builtinPreferences ?? EMPTY_PREFERENCES;
      const updated = update(current);
      preferences = sanitizeBuiltinPreferences(updated);
      for (const name of Object.keys(preferences)) {
        if (current[name] && updated[name] === current[name]) preferences[name] = current[name];
      }
      await persistSettingsWithinTransaction(
        {
          ...previous,
          agentMode: {
            ...previous.agentMode,
            skills: { ...previous.agentMode.skills, builtinPreferences: preferences },
          },
        },
        saveData,
        previous
      );
    });
    // Activate after the transaction exits so the subscriber's save uses the new
    // epoch and includes edits made during the durable write. A failed write must
    // never activate cleanup that a restart would undo.
    // https://github.com/logancyang/obsidian-copilot/issues/3022
    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        skills: { ...current.agentMode.skills, builtinPreferences: preferences },
      },
    }));
    return preferences;
  });
  preferenceWrites = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
