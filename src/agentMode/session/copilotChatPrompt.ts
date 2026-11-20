import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";

// The prompt every chat shares names no identity, so a chat that runs as no agent took the coding agent's own name; it is told it is Copilot where an agent's chat says who the agent is, and not while the user turns the built-in prompt off.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/986
const COPILOT_CHAT_IDENTITY = "You are Obsidian Copilot.";

export function buildCopilotChatPrompt(): string | null {
  return getDisableBuiltinSystemPrompt() ? null : COPILOT_CHAT_IDENTITY;
}
