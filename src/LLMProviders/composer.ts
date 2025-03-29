import { ChatHistoryEntry } from "@/utils";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import ProjectManager from "./projectManager";
import { Change, diffTrimmedLines } from "diff";
import { App, TFile } from "obsidian";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

interface ComposerNote {
  note_path: string;
  note_content: string;
}

interface ComposerResponse {
  notes?: ComposerNote[];
  error?: string;
}

export class Composer {
  private static instance: Composer;
  private static changesMap: { [key: string]: Change[] } = {};
  private constructor() {}

  public static getInstance(): Composer {
    if (!Composer.instance) {
      Composer.instance = new Composer();
    }
    return Composer.instance;
  }

  public static getChanges(notePath: string): Change[] {
    return Composer.changesMap[notePath] || [];
  }

  // Group changes into blocks for better UI presentation
  public static getChangeBlocks(changes: Change[]): Change[][] {
    const blocks: Change[][] = [];
    let currentBlock: Change[] = [];

    changes.forEach((change) => {
      if (change.added || change.removed) {
        currentBlock.push(change);
      } else {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
        blocks.push([change]);
      }
    });
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }
    return blocks;
  }

  private async composerResponse(
    content: string,
    chatHistory: ChatHistoryEntry[],
    debug: boolean
  ): Promise<ComposerResponse> {
    const composerSystemPrompt = `
    You are a helpful assistant that creates markdown notes for obsidian users.

    # Task
    Your task is to generate one or more markdown notes when the user input contains @composer:
    1. For editing existing notes - Return the updated markdown note content and the original note path.
    2. For creating new notes - Return the new markdown note content and the new note path based on user's request.
    3. If user's request is not clear, such as the note path is not provided, return an error message.
    4. Do no include the title to the note content.
    5. You can return multiple notes if the user's request involves creating multiple notes.

    Below is the chat history the user and the previous assistant have had. You should continue the conversation if necessary but respond in a different format.
    <CHAT_HISTORY>
    ${chatHistory.map((entry) => `${entry.role}: ${entry.content}`).join("\n")}
    </CHAT_HISTORY>`;

    // Define the schema for the output
    const schema = z.object({
      notes: z
        .array(
          z.object({
            note_path: z.string().refine((val) => val.endsWith(".md"), {
              message: "note_path must end with .md",
            }),
            note_content: z.string(),
          })
        )
        .optional(),
      error: z.string().optional(),
    });

    // Create the output parser
    const parser = StructuredOutputParser.fromZodSchema(schema);

    const messages: any[] = [
      {
        role: "system",
        content: composerSystemPrompt + "\n\n" + parser.getFormatInstructions(),
      },
    ];

    // Get the current chat model
    const chatModel = ProjectManager.instance
      .getCurrentChainManager()
      .chatModelManager.getChatModel()
      .bind({
        temperature: 0,
        maxTokens: 16000,
      } as BaseChatModelCallOptions);

    // Add current user message
    messages.push({
      role: "user",
      content: content,
    });

    if (debug) {
      console.log("==== Composer Request ====\n", messages);
    }

    try {
      const response = await chatModel.invoke(messages);
      const responseContent =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      console.log("==== Composer Response ====\n", responseContent);
      return await parser.parse(responseContent);
    } catch (error) {
      console.error("Error parsing composer response:", error);
      return {
        error: `Error parsing composer response: ${error.message}`,
      };
    }
  }

  public async composerUserMessage(
    originalMessage: string,
    messageWithContext: string,
    chatHistory: ChatHistoryEntry[],
    debug: boolean
  ): Promise<string> {
    const composerOutput = await this.composerResponse(messageWithContext, chatHistory, debug);
    if (debug) {
      console.log("==== Composer Output ====\n", composerOutput);
    }
    if (!composerOutput.error) {
      const notes = composerOutput.notes || [];
      const changesMarkdownPromises = notes.map(async (note: ComposerNote) => {
        const changesMarkdown = await this.getChangesMarkdown(
          app,
          note.note_path,
          note.note_content,
          debug
        );
        return `\`\`\`markdown
<!-- path=${note.note_path} -->
${changesMarkdown}
\`\`\``;
      });
      const changesMarkdownBlocks = await Promise.all(changesMarkdownPromises);

      return `User message: ${originalMessage}

The user is calling @composer tool to generate note content. Below are the markdown blocks representing the changes from the @composer output:

${changesMarkdownBlocks.join("\n\n")}

Return the markdown blocks above directly and add a brief summary of the changes at the end.`;
    } else {
      return `User message: ${originalMessage}

The user is calling @composer tool to generate note content. However, the note content was not created successfully. Below is the output

${composerOutput.error}`;
    }
  }

  // Break content into lines and wrap each line in ~~
  private strikeThrough(content: string): string {
    const lines = content.trim().split("\n");
    return lines.map((line) => "~~" + line.trim() + "~~").join("\n");
  }

  // Get relevant changes only and combine them into a single markdown block
  private getRelevantChangesMarkdown(blocks: Change[][]): string {
    const renderedChanges = blocks
      .map((block) => {
        const hasAddedChanges = block.some((change) => change.added);
        const hasRemovedChanges = block.some((change) => change.removed);
        let blockChange = "";
        if (hasAddedChanges) {
          blockChange = block.map((change) => (change.added ? change.value : "")).join("\n");
        } else if (hasRemovedChanges) {
          blockChange = block
            .map((change) => (change.removed ? this.strikeThrough(change.value) : ""))
            .join("\n");
        } else {
          blockChange = "...";
        }
        return blockChange;
      })
      .join("\n");
    return renderedChanges;
  }

  private async getChangesMarkdown(
    app: App,
    path: string,
    newContent: string,
    debug: boolean = false
  ): Promise<string> {
    try {
      // Get the file from the path
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) {
        // If the file does not exist, return the newContent directly
        return newContent;
      }

      if (!(file instanceof TFile)) {
        throw new Error(`Path is not a file: ${path}`);
      }

      // Read the original content
      const originalContent = await app.vault.read(file);
      // Get the diff
      const changes = diffTrimmedLines(originalContent, newContent, { newlineIsToken: true });
      // Cache the changes to be used by the Apply view.
      Composer.changesMap[path] = changes;

      console.log("==== Changes ====\n", changes);

      // Group changes into blocks
      const blocks = Composer.getChangeBlocks(changes);

      // Process blocks into markdown
      const markdownChanges = this.getRelevantChangesMarkdown(blocks);

      return markdownChanges;
    } catch (error) {
      console.error("Error getting changes markdown:", error);
      throw error;
    }
  }
}
