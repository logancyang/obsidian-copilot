import type { ProtectedFiles } from "@/agentMode/session/protectedFiles";
import { customAgentsFolderPath } from "@/agents/CustomAgentStore";
import { INSTRUCTIONS_FILE_NAME } from "@/agents/customAgentFiles";

// A folder holding an instructions.md is an agent, so no model may write one, in any chat or approval mode; the reason sends the user to the Open instruction link or the draft card.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/989
export function protectedInstructionFiles(vaultBase: string): ProtectedFiles {
  return {
    folder: `${vaultBase}/${customAgentsFolderPath()}`,
    fileName: INSTRUCTIONS_FILE_NAME,
    reason:
      "Copilot refused this change: only the user edits an agent's instructions.md and creates agents. Give the user the agent's Open instruction link to edit its instruction, or draft a new agent for them to review and create from the card.",
  };
}
