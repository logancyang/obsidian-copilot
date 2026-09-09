import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
} from "@/services/settingsPersistence";

/**
 * Save built-in opt-outs before activating filesystem cleanup.
 * @param preferences - Built-in choices to persist, including completed migration records.
 * @param saveData - Plugin writer that applies device-specific settings storage.
 */
export async function saveBuiltinPreferences(
  preferences: NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>,
  saveData: (data: CopilotSettings) => Promise<void>
): Promise<void> {
  await runPersistenceTransaction(async () => {
    const previous = getSettings();
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
}
