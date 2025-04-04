import React from "react";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { Composer } from "@/LLMProviders/composer";
import { logError } from "@/logger";
import { Notice } from "obsidian";
import { TFile } from "obsidian";

interface ComposerCodeBlockProps {
  code: string;
  path: string;
}

export const ComposerCodeBlock: React.FC<ComposerCodeBlockProps> = ({ path, code }) => {
  const handleApply = async () => {
    if (!path) return;

    try {
      const changes = Composer.getChanges(path);
      let file = app.vault.getAbstractFileByPath(path);

      let isNewFile = false;

      // If file doesn't exist, create it
      if (!file) {
        try {
          // Create the folder if it doesn't exist
          if (path.includes("/")) {
            const folderPath = path.split("/").slice(0, -1).join("/");
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (!folder) {
              await app.vault.createFolder(folderPath);
            }
          }
          file = await app.vault.create(path, code);
          if (file) {
            new Notice(`Created new file: ${path}`);
            isNewFile = true;
          } else {
            new Notice(`Failed to create file: ${path}`);
            return;
          }

          isNewFile = true;
        } catch (createError) {
          logError("Error creating file:", createError);
          new Notice(`Failed to create file: ${createError.message}`);
          return;
        }
      }

      if (!(file instanceof TFile)) {
        new Notice(`Path is not a file: ${path}`);
        return;
      }

      // Check if the current active note is the same as the target note
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile || activeFile.path !== path) {
        // If not, open the target file in the current leaf
        await app.workspace.getLeaf().openFile(file);
        new Notice(`Switched to ${file.name}`);
      }

      // If the file is newly created, don't show the apply view
      if (isNewFile) {
        return;
      }

      // Open the Apply View in a new leaf with the processed content
      const leaf = app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: APPLY_VIEW_TYPE,
        active: true,
        state: {
          changes,
          path,
        },
      });
    } catch (error) {
      logError("Error calling composer apply:", error);
      new Notice(`Error processing code: ${error.message}`);
    }
  };

  return (
    <div className="border border-border border-solid rounded-md my-2 flex flex-col overflow-hidden">
      {path && (
        <div className="flex justify-between items-center border-[0px] border-b border-border border-solid gap-2 p-2 overflow-hidden">
          <div className="text-xs p-1 text-muted-foreground truncate flex-1">{path}</div>
          {
            <Button className="text-muted" variant="ghost2" size="fit" onClick={handleApply}>
              <Check className="h-4 w-4" />
              Apply
            </Button>
          }
        </div>
      )}
      <pre className="m-0 border-none">
        <code>{code}</code>
      </pre>
    </div>
  );
};
