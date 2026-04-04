import { logInfo } from "@/logger";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

/**
 * Tool to append content to an existing note (at end, or under a specific heading).
 */
const appendToNoteTool = createLangChainTool({
  name: "appendToNote",
  description:
    "Append content to the end of an existing note, or under a specific heading. Safer than writeFile for adding to logs, journals, lists, or meeting notes.",
  schema: z.object({
    notePath: z
      .string()
      .min(1)
      .describe("Vault-relative path to the note (e.g. 'Daily Notes/2024-01-15.md')"),
    content: z.string().min(1).describe("The content to append"),
    heading: z
      .string()
      .optional()
      .describe(
        "Optional: append under this heading instead of at the end. Must match exactly (e.g. '## Tasks')"
      ),
  }),
  func: async ({ notePath, content, heading }) => {
    try {
      const vault = app.vault;
      const file = vault.getAbstractFileByPath(notePath);

      if (!file || !("extension" in file)) {
        return {
          success: false,
          message: `Note not found: ${notePath}`,
        };
      }

      const existingContent = await vault.read(file as any);

      let newContent: string;
      if (heading) {
        // Find the heading and append after its section
        const headingRegex = new RegExp(
          `^(${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})$`,
          "m"
        );
        const match = existingContent.match(headingRegex);

        if (!match || match.index === undefined) {
          return {
            success: false,
            message: `Heading "${heading}" not found in ${notePath}`,
          };
        }

        // Find the end of the heading's section (next heading of same or higher level, or end of file)
        const headingLevel = (heading.match(/^#+/) || [""])[0].length;
        const afterHeading = existingContent.substring(match.index + match[0].length);
        const nextHeadingRegex = new RegExp(`^#{1,${headingLevel}}\\s`, "m");
        const nextMatch = afterHeading.match(nextHeadingRegex);

        if (nextMatch && nextMatch.index !== undefined) {
          // Insert before the next heading
          const insertPoint = match.index + match[0].length + nextMatch.index;
          newContent =
            existingContent.substring(0, insertPoint).trimEnd() +
            "\n" +
            content +
            "\n\n" +
            existingContent.substring(insertPoint);
        } else {
          // Append at end of file (heading is the last section)
          newContent = existingContent.trimEnd() + "\n" + content + "\n";
        }
      } else {
        // Append at end of file
        newContent = existingContent.trimEnd() + "\n\n" + content + "\n";
      }

      await vault.modify(file as any, newContent);
      logInfo(`[appendToNote] Appended to ${notePath}${heading ? ` under ${heading}` : ""}`);

      return {
        success: true,
        message: `Content appended to ${notePath}${heading ? ` under "${heading}"` : ""}`,
        path: notePath,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to append to ${notePath}: ${error.message}`,
      };
    }
  },
});

/**
 * Tool to rename or move a note in the vault.
 */
const renameNoteTool = createLangChainTool({
  name: "renameNote",
  description:
    "Rename or move a note to a new path. Obsidian automatically updates all internal links pointing to the renamed note.",
  schema: z.object({
    oldPath: z
      .string()
      .min(1)
      .describe("Current vault-relative path of the note (e.g. 'Inbox/draft.md')"),
    newPath: z.string().min(1).describe("New vault-relative path (e.g. 'Projects/final-draft.md')"),
  }),
  func: async ({ oldPath, newPath }) => {
    try {
      const vault = app.vault;
      const file = vault.getAbstractFileByPath(oldPath);

      if (!file) {
        return {
          success: false,
          message: `Note not found: ${oldPath}`,
        };
      }

      // Ensure target directory exists
      const targetDir = newPath.substring(0, newPath.lastIndexOf("/"));
      if (targetDir) {
        const dirExists = vault.getAbstractFileByPath(targetDir);
        if (!dirExists) {
          await vault.createFolder(targetDir);
        }
      }

      await vault.rename(file, newPath);
      logInfo(`[renameNote] Renamed ${oldPath} → ${newPath}`);

      return {
        success: true,
        message: `Note renamed from "${oldPath}" to "${newPath}". Internal links have been updated automatically.`,
        oldPath,
        newPath,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to rename ${oldPath}: ${error.message}`,
      };
    }
  },
});

export { appendToNoteTool, renameNoteTool };
