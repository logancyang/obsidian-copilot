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
//
// `project.md` is the single source of truth for a project: frontmatter config plus the
// markdown instruction body. It is the only file the scanner/register recognize, and it is
// never renamed. `AGENTS.md` is a one-way, plugin-generated mirror of the composed project
// instructions — the built-in project policy layered ahead of the `project.md` body (see
// {@link ensureAgentsMirror}) — that codex/opencode auto-discover from the session cwd. It is
// derived output, never a config source, and is excluded from recognition here.
export const PROJECT_CONFIG_FILE_NAME = "project.md";

/** Bare file name of the generated, one-way instruction mirror read by codex/opencode from cwd. */
export const AGENTS_MIRROR_FILE = "AGENTS.md";

/**
 * Folder, relative to a project's directory (the session cwd), where the agent is steered to
 * write generated/intermediate files. A name, not a path: the built-in project system prompt
 * (`projectSystemPrompt.ts`) and any future Outputs UI both reference this single constant
 * instead of re-hardcoding the string.
 */
export const PROJECT_OUTPUTS_DIRNAME = "outputs";

export const PROJECTS_UNSUPPORTED_FOLDER_NAME = "unsupported";
