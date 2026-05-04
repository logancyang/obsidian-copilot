import { ProjectConfig } from "@/aiParams";

/**
 * Empty project config used as default/fallback for missing fields.
 */
export const EMPTY_PROJECT_CONFIG: ProjectConfig = {
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  projectModelKey: "",
  modelConfigs: {},
  contextSource: {},
  created: 0,
  UsageTimestamps: 0,
};

// Frontmatter property keys (copilot-project-* prefix to avoid user property conflicts)
export const COPILOT_PROJECT_ID = "copilot-project-id";
export const COPILOT_PROJECT_NAME = "copilot-project-name";
export const COPILOT_PROJECT_DESCRIPTION = "copilot-project-description";
export const COPILOT_PROJECT_MODEL_KEY = "copilot-project-model-key";
export const COPILOT_PROJECT_TEMPERATURE = "copilot-project-temperature";
export const COPILOT_PROJECT_MAX_TOKENS = "copilot-project-max-tokens";
export const COPILOT_PROJECT_CREATED = "copilot-project-created";
export const COPILOT_PROJECT_LAST_USED = "copilot-project-last-used";
export const COPILOT_PROJECT_INCLUSIONS = "copilot-project-inclusions";
export const COPILOT_PROJECT_EXCLUSIONS = "copilot-project-exclusions";
export const COPILOT_PROJECT_WEB_URLS = "copilot-project-web-urls";
export const COPILOT_PROJECT_YOUTUBE_URLS = "copilot-project-youtube-urls";

// File structure conventions
export const PROJECT_CONFIG_FILE_NAME = "project.md";
export const PROJECTS_UNSUPPORTED_FOLDER_NAME = "unsupported";
