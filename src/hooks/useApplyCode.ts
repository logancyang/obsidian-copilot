import { App, Notice, TFile } from "obsidian";
import { useCallback } from "react";
import { BrevilabsClient, ComposerApplyRequest } from "@/LLMProviders/brevilabsClient";
import { ChatMessage } from "@/sharedState";
import { USER_SENDER } from "@/constants";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { logError, logInfo } from "@/logger";

/**
 * Custom hook for applying code to a file using the composer API
 * @param app The Obsidian app instance
 * @param chatHistory The chat history to provide context for the code application
 * @returns A callback function to apply code to a file
 */
export function useApplyCode(app: App, chatHistory: ChatMessage[] = []) {
  return useCallback(
    async (path: string, code: string) => {
      try {
        // Get the file from the path
        const file = app.vault.getAbstractFileByPath(path);

        if (!file || !(file instanceof TFile)) {
          new Notice(`File not found: ${path}`);
          return;
        }

        // Get the original content
        const originalContent = await app.vault.read(file);

        // Check if the current active note is the same as the target note
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile || activeFile.path !== file.path) {
          // If not, open the target file in the current leaf
          await app.workspace.getLeaf().openFile(file);
          new Notice(`Switched to ${file.name}`);
        }

        try {
          // Call the composer apply endpoint
          const brevilabsClient = BrevilabsClient.getInstance();

          // Convert chat history to the format expected by the API
          const formattedChatHistory = chatHistory
            .filter((msg) => msg.isVisible)
            .map((msg) => ({
              role: msg.sender === USER_SENDER ? "user" : "assistant",
              content: msg.message,
            }));

          // Create the request object
          const request: ComposerApplyRequest = {
            target_note: {
              title: file.basename,
              content: originalContent,
            },
            chat_history: formattedChatHistory,
            markdown_block: code,
          };

          // Call the composer apply endpoint
          logInfo("==== Composer Request ====\n", request);
          const response = await brevilabsClient.composerApply(request);

          // Use the content from the response
          let newContent = response.content;

          // Remove the code block markers if they exist
          //TODO: Remove this once the issue is fixed in the backend
          if (newContent.startsWith("```\n") && newContent.endsWith("\n```")) {
            newContent = newContent.slice(4, -4);
          }
          if (newContent.startsWith("```markdown\n") && newContent.endsWith("\n```")) {
            newContent = newContent.slice(12, -4);
          }

          // Remove trailing newline from newContent if originalContent doesn't end with one
          //TODO: Remove this once the issue is fixed in the backend
          if (!originalContent.endsWith("\n") && newContent.endsWith("\n")) {
            newContent = newContent.slice(0, -1);
          }

          // Open the Apply View in a new leaf with the processed content
          const leaf = app.workspace.getLeaf(true);
          await leaf.setViewState({
            type: APPLY_VIEW_TYPE,
            active: true,
            state: {
              file,
              originalContent,
              newContent,
              path,
            },
          });
        } catch (error) {
          logError("Error calling composer apply:", error);
          new Notice(`Error processing code: ${error.message}`);

          // Fallback to original behavior if composer apply fails
          const leaf = app.workspace.getLeaf(true);
          await leaf.setViewState({
            type: APPLY_VIEW_TYPE,
            active: true,
            state: {
              file: file,
              originalContent: originalContent,
              newContent: code,
              path: path,
            },
          });
        }
      } catch (error) {
        logError("Error applying code:", error);
        new Notice(`Error applying code: ${error.message}`);
      }
    },
    [app, chatHistory]
  );
}
