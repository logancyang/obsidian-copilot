import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { Goal, GoalFrontmatter, GoalNote, ConversationRef } from "@/types/projects-plus";
import { ensureFolderExists } from "@/utils";
import { App, TFile, TFolder } from "obsidian";

/**
 * Escape a string for safe YAML double-quoted string value
 */
function escapeYamlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Slugify a goal name for use in folder names
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * GoalPersistence - Handles saving and loading goal data to/from disk
 *
 * Manages the goal.md file format:
 * - YAML frontmatter for metadata
 * - Markdown body for description
 *
 * Folder structure:
 * copilot/projects/
 * └── [goal-id]__[goal-name-slug]/
 *     ├── goal.md
 *     └── conversations/
 */
export class GoalPersistence {
  constructor(private app: App) {}

  /**
   * Get the base projects folder path from settings
   */
  private getProjectsFolder(): string {
    return getSettings().projectsPlusFolder;
  }

  /**
   * Get the folder path for a specific goal
   */
  getGoalFolderPath(goalId: string, goalName: string): string {
    const slug = slugify(goalName);
    return `${this.getProjectsFolder()}/${goalId}__${slug}`;
  }

  /**
   * Get the goal.md file path for a specific goal
   */
  getGoalFilePath(goalId: string, goalName: string): string {
    return `${this.getGoalFolderPath(goalId, goalName)}/goal.md`;
  }

  /**
   * Save a goal to disk
   */
  async saveGoal(goal: Goal): Promise<void> {
    try {
      const folderPath = this.getGoalFolderPath(goal.id, goal.name);
      const filePath = `${folderPath}/goal.md`;

      // Ensure goal folder exists
      await ensureFolderExists(folderPath);

      // Ensure conversations subfolder exists
      await ensureFolderExists(`${folderPath}/conversations`);

      // Generate content
      const content = this.generateGoalContent(goal);

      // Check if file exists
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, content);
        logInfo(`[GoalPersistence] Updated goal file: ${filePath}`);
      } else {
        await this.app.vault.create(filePath, content);
        logInfo(`[GoalPersistence] Created goal file: ${filePath}`);
      }
    } catch (error) {
      logError("[GoalPersistence] Error saving goal:", error);
      throw error;
    }
  }

  /**
   * Load a goal from a goal.md file path
   */
  async loadGoal(goalFilePath: string): Promise<Goal | null> {
    try {
      const file = this.app.vault.getAbstractFileByPath(goalFilePath);
      if (!(file instanceof TFile)) {
        logWarn(`[GoalPersistence] Goal file not found: ${goalFilePath}`);
        return null;
      }

      const content = await this.app.vault.read(file);
      return this.parseGoalContent(content);
    } catch (error) {
      logError(`[GoalPersistence] Error loading goal from ${goalFilePath}:`, error);
      return null;
    }
  }

  /**
   * Load all goals from the projects folder
   */
  async loadAllGoals(): Promise<Goal[]> {
    const goals: Goal[] = [];
    const projectsFolder = this.getProjectsFolder();

    try {
      const folder = this.app.vault.getAbstractFileByPath(projectsFolder);
      if (!(folder instanceof TFolder)) {
        // Projects folder doesn't exist yet
        logInfo(`[GoalPersistence] Projects folder not found: ${projectsFolder}`);
        return goals;
      }

      // Iterate through subfolders
      for (const child of folder.children) {
        if (!(child instanceof TFolder)) continue;

        // Look for goal.md in each subfolder
        const goalFilePath = `${child.path}/goal.md`;
        const goal = await this.loadGoal(goalFilePath);
        if (goal) {
          goals.push(goal);
        }
      }

      logInfo(`[GoalPersistence] Loaded ${goals.length} goals`);
      return goals;
    } catch (error) {
      logError("[GoalPersistence] Error loading all goals:", error);
      return goals;
    }
  }

  /**
   * Delete a goal and its folder
   */
  async deleteGoal(goal: Goal): Promise<void> {
    try {
      const folderPath = this.getGoalFolderPath(goal.id, goal.name);
      const folder = this.app.vault.getAbstractFileByPath(folderPath);

      if (folder instanceof TFolder) {
        // Delete the entire folder recursively
        await this.app.vault.delete(folder, true);
        logInfo(`[GoalPersistence] Deleted goal folder: ${folderPath}`);
      } else {
        logWarn(`[GoalPersistence] Goal folder not found for deletion: ${folderPath}`);
      }
    } catch (error) {
      logError("[GoalPersistence] Error deleting goal:", error);
      throw error;
    }
  }

  /**
   * Rename a goal folder when goal name changes
   */
  async renameGoalFolder(goal: Goal, oldName: string): Promise<void> {
    try {
      const oldFolderPath = this.getGoalFolderPath(goal.id, oldName);
      const newFolderPath = this.getGoalFolderPath(goal.id, goal.name);

      if (oldFolderPath === newFolderPath) {
        // No rename needed
        return;
      }

      const oldFolder = this.app.vault.getAbstractFileByPath(oldFolderPath);
      if (oldFolder instanceof TFolder) {
        await this.app.fileManager.renameFile(oldFolder, newFolderPath);
        logInfo(`[GoalPersistence] Renamed goal folder: ${oldFolderPath} -> ${newFolderPath}`);
      }
    } catch (error) {
      logError("[GoalPersistence] Error renaming goal folder:", error);
      throw error;
    }
  }

  /**
   * Parse goal.md content into a Goal object
   */
  private parseGoalContent(content: string): Goal | null {
    try {
      // Extract YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        logWarn("[GoalPersistence] No frontmatter found in goal file");
        return null;
      }

      const frontmatterStr = frontmatterMatch[1];
      const frontmatter = this.parseYamlFrontmatter(frontmatterStr);
      if (!frontmatter) {
        return null;
      }

      // Extract description from markdown body (everything after frontmatter, skip the title line)
      const bodyContent = content.slice(frontmatterMatch[0].length).trim();
      const lines = bodyContent.split("\n");

      // Skip the title line (# Goal Name)
      const descriptionLines = lines.filter((line) => !line.startsWith("# "));
      const description = descriptionLines.join("\n").trim();

      return {
        id: frontmatter.id,
        name: frontmatter.name,
        description,
        status: frontmatter.status,
        notes: frontmatter.notes || [],
        conversations: frontmatter.conversations || [],
        createdAt: frontmatter.createdAt,
        updatedAt: frontmatter.updatedAt,
        completedAt: frontmatter.completedAt,
        reflection: frontmatter.reflection,
      };
    } catch (error) {
      logError("[GoalPersistence] Error parsing goal content:", error);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter string into GoalFrontmatter object
   */
  private parseYamlFrontmatter(yamlStr: string): GoalFrontmatter | null {
    try {
      const result: Partial<GoalFrontmatter> = {};

      // Parse simple key-value pairs
      const lines = yamlStr.split("\n");
      let i = 0;

      while (i < lines.length) {
        const line = lines[i].trim();

        if (line.startsWith("id:")) {
          result.id = this.parseYamlValue(line.slice(3));
        } else if (line.startsWith("name:")) {
          result.name = this.parseYamlValue(line.slice(5));
        } else if (line.startsWith("status:")) {
          const status = this.parseYamlValue(line.slice(7));
          if (status === "active" || status === "completed" || status === "archived") {
            result.status = status;
          }
        } else if (line.startsWith("createdAt:")) {
          result.createdAt = parseInt(this.parseYamlValue(line.slice(10)), 10);
        } else if (line.startsWith("updatedAt:")) {
          result.updatedAt = parseInt(this.parseYamlValue(line.slice(10)), 10);
        } else if (line.startsWith("completedAt:")) {
          const val = this.parseYamlValue(line.slice(12));
          if (val) {
            result.completedAt = parseInt(val, 10);
          }
        } else if (line.startsWith("reflection:")) {
          result.reflection = this.parseYamlValue(line.slice(11));
        } else if (line === "notes:") {
          // Parse notes array
          result.notes = [];
          i++;
          while (i < lines.length && lines[i].startsWith("  -")) {
            const note = this.parseNoteEntry(lines, i);
            if (note.item) {
              result.notes.push(note.item);
            }
            i = note.nextIndex;
          }
          continue;
        } else if (line === "conversations:") {
          // Parse conversations array
          result.conversations = [];
          i++;
          while (i < lines.length && lines[i].startsWith("  -")) {
            const conv = this.parseConversationEntry(lines, i);
            if (conv.item) {
              result.conversations.push(conv.item);
            }
            i = conv.nextIndex;
          }
          continue;
        }
        i++;
      }

      // Validate required fields
      if (!result.id || !result.name || !result.status || !result.createdAt || !result.updatedAt) {
        logWarn("[GoalPersistence] Missing required fields in frontmatter");
        return null;
      }

      return result as GoalFrontmatter;
    } catch (error) {
      logError("[GoalPersistence] Error parsing YAML frontmatter:", error);
      return null;
    }
  }

  /**
   * Parse a simple YAML value (removes quotes)
   */
  private parseYamlValue(value: string): string {
    const trimmed = value.trim();
    // Remove surrounding quotes
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return trimmed;
  }

  /**
   * Parse a note entry from YAML array
   */
  private parseNoteEntry(
    lines: string[],
    startIndex: number
  ): { item: GoalNote | null; nextIndex: number } {
    const note: Partial<GoalNote> = {};
    let i = startIndex;

    // First line starts with "  - "
    const firstLine = lines[i].slice(4).trim();
    if (firstLine.startsWith("path:")) {
      note.path = this.parseYamlValue(firstLine.slice(5));
    }
    i++;

    // Continue parsing indented properties
    while (i < lines.length && lines[i].startsWith("    ") && !lines[i].startsWith("  -")) {
      const line = lines[i].trim();
      if (line.startsWith("path:")) {
        note.path = this.parseYamlValue(line.slice(5));
      } else if (line.startsWith("assignedAt:")) {
        note.assignedAt = parseInt(this.parseYamlValue(line.slice(11)), 10);
      } else if (line.startsWith("relevanceScore:")) {
        const val = this.parseYamlValue(line.slice(15));
        if (val) {
          note.relevanceScore = parseFloat(val);
        }
      } else if (line.startsWith("manuallyAdded:")) {
        note.manuallyAdded = this.parseYamlValue(line.slice(14)) === "true";
      }
      i++;
    }

    if (note.path && note.assignedAt !== undefined && note.manuallyAdded !== undefined) {
      return { item: note as GoalNote, nextIndex: i };
    }

    return { item: null, nextIndex: i };
  }

  /**
   * Parse a conversation entry from YAML array
   */
  private parseConversationEntry(
    lines: string[],
    startIndex: number
  ): { item: ConversationRef | null; nextIndex: number } {
    const conv: Partial<ConversationRef> = {};
    let i = startIndex;

    // First line starts with "  - "
    const firstLine = lines[i].slice(4).trim();
    if (firstLine.startsWith("id:")) {
      conv.id = this.parseYamlValue(firstLine.slice(3));
    }
    i++;

    // Continue parsing indented properties
    while (i < lines.length && lines[i].startsWith("    ") && !lines[i].startsWith("  -")) {
      const line = lines[i].trim();
      if (line.startsWith("id:")) {
        conv.id = this.parseYamlValue(line.slice(3));
      } else if (line.startsWith("title:")) {
        conv.title = this.parseYamlValue(line.slice(6));
      } else if (line.startsWith("path:")) {
        conv.path = this.parseYamlValue(line.slice(5));
      } else if (line.startsWith("createdAt:")) {
        conv.createdAt = parseInt(this.parseYamlValue(line.slice(10)), 10);
      } else if (line.startsWith("messageCount:")) {
        conv.messageCount = parseInt(this.parseYamlValue(line.slice(13)), 10);
      }
      i++;
    }

    if (
      conv.id &&
      conv.title &&
      conv.path &&
      conv.createdAt !== undefined &&
      conv.messageCount !== undefined
    ) {
      return { item: conv as ConversationRef, nextIndex: i };
    }

    return { item: null, nextIndex: i };
  }

  /**
   * Generate goal.md content with YAML frontmatter
   */
  private generateGoalContent(goal: Goal): string {
    const notesYaml = this.generateNotesYaml(goal.notes);
    const conversationsYaml = this.generateConversationsYaml(goal.conversations);

    let frontmatter = `---
id: "${escapeYamlString(goal.id)}"
name: "${escapeYamlString(goal.name)}"
status: "${goal.status}"
createdAt: ${goal.createdAt}
updatedAt: ${goal.updatedAt}`;

    if (goal.completedAt) {
      frontmatter += `\ncompletedAt: ${goal.completedAt}`;
    }

    if (goal.reflection) {
      frontmatter += `\nreflection: "${escapeYamlString(goal.reflection)}"`;
    }

    frontmatter += `\n${notesYaml}`;
    frontmatter += `\n${conversationsYaml}`;
    frontmatter += `\n---`;

    const content = `${frontmatter}

# ${goal.name}

${goal.description}`;

    return content;
  }

  /**
   * Generate YAML for notes array
   */
  private generateNotesYaml(notes: GoalNote[]): string {
    if (notes.length === 0) {
      return "notes: []";
    }

    let yaml = "notes:";
    for (const note of notes) {
      yaml += `\n  - path: "${escapeYamlString(note.path)}"`;
      yaml += `\n    assignedAt: ${note.assignedAt}`;
      if (note.relevanceScore !== undefined) {
        yaml += `\n    relevanceScore: ${note.relevanceScore}`;
      }
      yaml += `\n    manuallyAdded: ${note.manuallyAdded}`;
    }
    return yaml;
  }

  /**
   * Generate YAML for conversations array
   */
  private generateConversationsYaml(conversations: ConversationRef[]): string {
    if (conversations.length === 0) {
      return "conversations: []";
    }

    let yaml = "conversations:";
    for (const conv of conversations) {
      yaml += `\n  - id: "${escapeYamlString(conv.id)}"`;
      yaml += `\n    title: "${escapeYamlString(conv.title)}"`;
      yaml += `\n    path: "${escapeYamlString(conv.path)}"`;
      yaml += `\n    createdAt: ${conv.createdAt}`;
      yaml += `\n    messageCount: ${conv.messageCount}`;
    }
    return yaml;
  }
}
