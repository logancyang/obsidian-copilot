export const COPILOT_SETTINGS_TAB_IDS = [
  "basic",
  "byok",
  "miyo",
  "skills",
  "connectors",
  "command",
  "selfhost",
  "advanced",
] as const;

export type CopilotSettingsTabId = (typeof COPILOT_SETTINGS_TAB_IDS)[number];
