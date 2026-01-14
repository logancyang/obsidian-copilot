import { UserSystemPrompt } from "@/system-prompts/type";

export const EMPTY_SYSTEM_PROMPT: UserSystemPrompt = {
  title: "",
  content: "",
  createdMs: 0,
  modifiedMs: 0,
  lastUsedMs: 0,
};

// System prompt frontmatter property constants
export const COPILOT_SYSTEM_PROMPT_CREATED = "copilot-system-prompt-created";
export const COPILOT_SYSTEM_PROMPT_MODIFIED = "copilot-system-prompt-modified";
export const COPILOT_SYSTEM_PROMPT_LAST_USED = "copilot-system-prompt-last-used";
