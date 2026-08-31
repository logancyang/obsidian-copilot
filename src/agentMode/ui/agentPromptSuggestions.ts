/**
 * Sample prompts the Agent Mode composer types out on an empty landing, one at
 * a time, to show what the agent can actually do with a vault (see
 * `PromptSuggestionPlaceholder`). A frozen pool, like `LANDING_GREETINGS` — no
 * live LLM call.
 *
 * Keep entries short enough to read at sidebar width (~65 characters),
 * self-contained (no `<topic>` fill-in-the-blank), plain text (they're inserted
 * verbatim when accepted), and free of any assumption about how a vault is
 * organized — every one has to make sense in a stranger's notes.
 */
import { t } from "@/i18n";

let promptSource: string | undefined;
let agentPromptSuggestions: readonly string[] = Object.freeze([]);

/** Return the reviewed, locale-specific Agent Home discovery prompts. */
export function getAgentPromptSuggestions(): readonly string[] {
  const source = t("agentChat.home.promptSuggestions");
  // A locale catalog can replace an English fallback after initialization, while unchanged
  // copy must keep one stable array reference for React callers.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/326
  if (source !== promptSource) {
    promptSource = source;
    agentPromptSuggestions = Object.freeze(source.split("|"));
  }
  return agentPromptSuggestions;
}
