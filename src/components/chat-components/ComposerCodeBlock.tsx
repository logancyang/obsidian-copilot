import React from "react";
import { Button } from "@/components/ui/button";
import { Check, Clipboard } from "lucide-react";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { logError } from "@/logger";
import { Notice } from "obsidian";
import { TFile } from "obsidian";
import { Change } from "diff";
import { getRelevantChangesMarkdown, getChangeBlocks } from "@/composerUtils";

interface ComposerCodeBlockProps {
  note_path: string;
  note_content: string;
  note_changes: Change[];
}

export const ComposerCodeBlock: React.FC<ComposerCodeBlockProps> = ({
  note_path,
  note_content,
  note_changes,
}) => {
  const handlePreview = async () => {
    if (!note_path) return;

    try {
      let file = app.vault.getAbstractFileByPath(note_path);

      let isNewFile = false;

      // If file doesn't exist, create it
      if (!file) {
        try {
          // Create the folder if it doesn't exist
          if (note_path.includes("/")) {
            const folderPath = note_path.split("/").slice(0, -1).join("/");
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (!folder) {
              await app.vault.createFolder(folderPath);
            }
          }
          file = await app.vault.create(note_path, note_content);
          if (file) {
            new Notice(`Created new file: ${note_path}`);
            isNewFile = true;
          } else {
            new Notice(`Failed to create file: ${note_path}`);
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
        new Notice(`Path is not a file: ${note_path}`);
        return;
      }

      // Check if the current active note is the same as the target note
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile || activeFile.path !== note_path) {
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
          changes: note_changes,
          path: note_path,
        },
      });
    } catch (error) {
      logError("Error calling composer apply:", error);
      new Notice(`Error processing code: ${error.message}`);
    }
  };

  const handleCopy = () => {
    try {
      const contentToCopy =
        note_changes.length > 0
          ? getRelevantChangesMarkdown(getChangeBlocks(note_changes))
          : note_content;

      navigator.clipboard.writeText(contentToCopy);
      new Notice("Content copied to clipboard");
    } catch (error) {
      logError("Error copying to clipboard:", error);
      new Notice(`Failed to copy: ${error.message}`);
    }
  };

  return (
    <div className="border border-border border-solid rounded-md my-2 flex flex-col overflow-hidden">
      {note_path && (
        <div className="flex justify-between items-center border-[0px] border-b border-border border-solid gap-2 p-2 overflow-hidden">
          <div className="text-xs p-1 text-muted-foreground truncate flex-1">{note_path}</div>
          <div className="flex gap-2">
            <Button className="text-muted" variant="ghost2" size="fit" onClick={handleCopy}>
              <Clipboard className="h-4 w-4" />
              Copy
            </Button>
            <Button className="text-muted" variant="ghost2" size="fit" onClick={handlePreview}>
              <Check className="h-4 w-4" />
              Preview
            </Button>
          </div>
        </div>
      )}
      <pre className="m-0 border-none">
        <code>
          {note_changes.length > 0
            ? getRelevantChangesMarkdown(getChangeBlocks(note_changes))
            : note_content}
        </code>
      </pre>
    </div>
  );
};
