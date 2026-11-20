import type { ProtectedFiles } from "@/agentMode/session/protectedFiles";
import { customAgentsFolderPath } from "@/agents/CustomAgentStore";
import { INSTRUCTIONS_FILE_NAME } from "@/agents/customAgentFiles";

// A folder holding an instructions.md is an agent, so no model may write one, in any chat or approval mode; the reason states only the rule, because the Open instruction link and the draft card exist only in some chats, and those chats already say how to use them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/989
export function protectedInstructionFiles(vaultBase: string): ProtectedFiles {
  return {
    folder: `${vaultBase}/${customAgentsFolderPath()}`,
    fileName: INSTRUCTIONS_FILE_NAME,
    reason:
      "Copilot refused this change: only the user edits an agent's instructions.md and creates agents.",
  };
}
