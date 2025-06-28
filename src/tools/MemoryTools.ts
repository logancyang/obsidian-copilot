import { tool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Vault, TFile, TFolder, Notice } from "obsidian";
import { z } from "zod";
import { logInfo, logError } from "@/logger";
import { TimeInfo, getCurrentTimeTool } from "./TimeTools";
import { getSettings } from "@/settings/model";
import { ToolManager } from "@/tools/toolManager";

function getMemoryFilePath(): string {
  return getSettings().memoryFolder + "/memory.md";
}

async function getMemory(vault: Vault): Promise<string> {
  const file = vault.getAbstractFileByPath(getMemoryFilePath());
  if (file instanceof TFile) {
    return await vault.read(file);
  }
  return "";
}

async function writeMemory(vault: Vault, content: string): Promise<void> {
  const memoryFolder = getSettings().memoryFolder;
  const folder = vault.getAbstractFileByPath(memoryFolder);

  if (!folder) {
    await vault.createFolder(memoryFolder);
  } else if (!(folder instanceof TFolder)) {
    new Notice(`Path ${memoryFolder} exists but is not a folder.`);
    return;
  }

  const file = vault.getAbstractFileByPath(getMemoryFilePath());
  if (file instanceof TFile) {
    await vault.modify(file, content);
  } else {
    await vault.create(getMemoryFilePath(), content);
  }
}

function createMemoryUpdatePrompt(
  memory: string,
  userInput: string,
  currentTime: TimeInfo
): string {
  return `You are an AI assistant responsible for maintaining a list of user preferences and personal information.
The user's current memory is a list of concise, one-line items in Markdown.
Each item contains the date when the memory was created or udpated, and the content.

<task>
Your task is to analyze the user's request and the existing memory, then decide if an update is needed.

When you update the memory, you MUST group related items under descriptive markdown headings (e.g., "## Family", "## Work", "## Hobbies").

# What information to remember

- If user explictly ask you to remember it, remember it.
- If user input contains personal preferences or facts that can help you personalize your answers AND it has long-terms values, remember it.
</task>

<current_datetime>
${currentTime.userLocaleString}
</current_datetime>

<current_memory>
---
${memory || "No memory items yet."}
</current_memory>

<user_input>
${userInput}
</user_input>

# OUTPUT

Decide if you should update the memory:
If YES, respond with a brief, user-facing summary of the changes, followed by the complete, updated memory list.
Each new or udpated memory item MUST be prefixed with the current date in [YYYY-MM-DD] format.
Old memory items should stay unchanged.

You MUST use the following format. Do not add any other text.

<output_example>
SUMMARY:
Your summary of the update here.
---
MEMORY:
## Personal
- [2024-02-2] Birthday is on August 2nd.
- [2025-06-28] Plan to visit Sydney in 2026 summer.

## Work
- [2023-07-8] Manager's name is Jane Doe.
</output_example>

If NO, you MUST respond with the exact text "NO_UPDATE" and nothing else.`;
}

export const createMemoryTool = (chatModel: BaseChatModel, vault: Vault) =>
  tool(
    async ({ userInput }: { userInput: string }) => {
      try {
        logInfo("Memory tool called with user input:", userInput);

        const existingMemory = await getMemory(vault);
        const currentTime = await ToolManager.callTool(getCurrentTimeTool, {});
        const prompt = createMemoryUpdatePrompt(existingMemory, userInput, currentTime);

        const response = await chatModel.invoke(prompt);
        const responseText =
          typeof response.content === "string" ? response.content : response.content.toString();

        if (responseText.trim().toUpperCase() === "NO_UPDATE") {
          logInfo("No memory update needed.");
          return "No memory update was necessary.";
        }

        const parts = responseText.split("---");
        if (parts.length === 2) {
          const summary = parts[0].replace("SUMMARY:", "").trim();
          const newMemory = parts[1].replace("MEMORY:", "").trim();
          logInfo("Updating memory note.");
          await writeMemory(vault, newMemory);
          return (
            `User's memory in copilot got updated. You should acknowledge user this update at the end of the response and make sure include the link to the memory note.

					<acknowlege_example>
					NOTE: Your preference of traveling by airplane has been updated to [memory.md]
					</acknowlege_example>

					# Memory update summary

					` + summary
          );
        } else {
          logInfo("Could not parse summary and memory from response, saving entire response.");
          await writeMemory(vault, responseText.trim());
          return "Memory updated.";
        }
      } catch (error) {
        logError("Error in memory tool:", error);
        return "There was an error while updating memory.";
      }
    },
    {
      name: "updateMemory",
      description:
        "Updates user preferences and personal info based on the conversation. This tool should be used when the user states a preference or provides personal information.",
      schema: z.object({
        userInput: z.string().describe("The user's latest prompt or message."),
      }),
    }
  );
