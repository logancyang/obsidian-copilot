import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { removeThinkTags, ChatHistoryEntry } from "@/utils";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import ProjectManager from "@/LLMProviders/projectManager";

export async function getComposerOutput(
  message_with_context: string,
  chatHistory: ChatHistoryEntry[]
): Promise<string> {
  const composerPromptTemplate = `You are a helpful assistant that creates or edits note content.

<INPUT>
{message_with_context}
</INPUT>

<CHAT_HISTORY>
{chat_history}
</CHAT_HISTORY>

Based on the <INPUT> and <CHAT_HISTORY>, your task is to either:
1. Edit an existing note - In this case, the <INPUT> contains the target note path and current content. Modify it according to the user's request.
2. Create a new note - Generate appropriate content based on the user's request.

Return your response in JSON format with the following fields:
* "note_content": "The complete content of the note after your changes"
* "note_path": "The path of the note (either existing path or new path for new notes)"
`;

  const formattedChatHistory = chatHistory
    .map(({ role, content }) => `${role}: ${content}`)
    .join("\n");

  const chatModel = ProjectManager.instance
    .getCurrentChainManager()
    .chatModelManager.getChatModel()
    .bind({ temperature: 0 } as BaseChatModelCallOptions);
  const prompt = composerPromptTemplate
    .replace("{chat_history}", formattedChatHistory)
    .replace("{message_with_context}", message_with_context);

  console.log("==== Composer Input ====\n", prompt);

  const response = await chatModel.invoke([
    {
      role: "user",
      content: prompt,
    },
  ]);

  return removeThinkTags(response.content as string);
}

const composerTool = tool(
  async ({
    message,
    chatHistory,
  }: {
    message: string;
    chatHistory: { role: string; content: string }[];
  }) => {
    // Implementation will be added later
    let composerOutput = await getComposerOutput(message, chatHistory as ChatHistoryEntry[]);
    composerOutput = composerOutput.trim();
    if (composerOutput.startsWith("```json") && composerOutput.endsWith("```")) {
      composerOutput = composerOutput.slice(7, -3);
    }
    console.log("==== Composer Output ====\n", composerOutput);
    const jsonOutput = JSON.parse(composerOutput);

    const output = `The user calls @composer tool to generate new note content.
Below are the generated change blocks in markdown.
<CHANGE_BLOCKS>
\`\`\`markdown
${jsonOutput.note_content}
\`\`\`
</CHANGE_BLOCKS>

Return above codeblocks directly to users and add summarize the changes`;
    return output;
  },
  {
    name: "composer",
    description: "Create new note content based on the query and chat context",
    schema: z.object({
      message: z.string().describe("The composition message including the note context"),
      chatHistory: z
        .array(
          z.object({
            role: z.string(),
            content: z.string(),
          })
        )
        .describe("Previous conversation turns with role and content"),
    }),
  }
);

export { composerTool };
