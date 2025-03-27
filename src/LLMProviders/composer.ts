import { ChatHistoryEntry } from "@/utils";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import ProjectManager from "./projectManager";
import { Change, diffTrimmedLines } from "diff";
import { App, TFile } from "obsidian";

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
  ): Promise<string> {
    const composerSystemPrompt = `
    You are a helpful assistant that creates markdown notes for obsidian users.

    # Task
    Your task is to generate the new markdown note content and the note path when the user input contains @composer:
    1. For editing existing notes - Return the updated markdown note content and the original note path.
    2. For creating new notes - Return the new markdown note content and the new note path based on user's request.
    3. If user's request is not clear, such as the note path is not provided, return an error message and set success to false.
    4. Do no include the title to the note content.

    Below is the chat history the user and the previous assistant have had. You should continue the conversation if necessary but respond in a different format.
    <CHAT_HISTORY>
    ${chatHistory.map((entry) => `${entry.role}: ${entry.content}`).join("\n")}
    </CHAT_HISTORY>

    # Output Format
    Return your response in JSON format with the following fields:
    * "note_path": Required. The path of the markdown file. Must end with .md. (either existing path or new path for new notes.
    * "note_content": Required. The complete content of the markdown note after your changes or the error message.
    * "success": Required. true or false. Whether the note content was created successfully.`;

    const messages: any[] = [
      {
        role: "system",
        content: composerSystemPrompt,
      },
    ];

    // Get the current chat model
    const chatModel = ProjectManager.instance
      .getCurrentChainManager()
      .chatModelManager.getChatModel()
      .bind({ temperature: 0, maxTokens: 16000 } as BaseChatModelCallOptions);

    // Add current user message
    messages.push({
      role: "user",
      content: content,
    });

    if (debug) {
      console.log("==== Composer Request ====\n", messages);
    }
    const response = await chatModel.invoke(messages);
    let responseContent = response.content as string;
    if (debug) {
      console.log("==== Composer Response ====\n", responseContent);
    }
    if (responseContent.startsWith("```json") && responseContent.endsWith("```")) {
      responseContent = responseContent.slice(7, -3);
    }
    return responseContent;
  }

  public async composerUserMessage(
    originalMessage: string,
    messageWithContext: string,
    chatHistory: ChatHistoryEntry[],
    debug: boolean
  ): Promise<string> {
    const composerOutputString = await this.composerResponse(
      messageWithContext,
      chatHistory,
      debug
    );
    const composerOutput = JSON.parse(composerOutputString);
    if (debug) {
      console.log("==== Composer Output ====\n", composerOutput);
    }
    if (composerOutput.success) {
      const changesMarkdown = await this.getChangesMarkdown(
        app,
        composerOutput.note_path,
        composerOutput.note_content,
        debug
      );
      return `User message: ${originalMessage}

        The user is calling @composer tool to generate note content. Below is the markdown block representing the changes from the @composer output:

        \`\`\`markdown
        <!-- path=${composerOutput.note_path} -->
        ${changesMarkdown}
        \`\`\`

        Return the markdown block above directly and add a brief summary of the changes at the end.`;
    } else {
      return `User message: ${originalMessage}

        The user is calling @composer tool to generate note content. However, the note content was not created successfully. Below is the output
        ${composerOutput.note_content}`;
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
