import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { Project, ProjectFrontmatter, ProjectNote, ConversationRef } from "@/types/projects-plus";
import { ensureFolderExists } from "@/utils";
import { App, TFile, TFolder } from "obsidian";

/**
 * Escape a string for safe YAML double-quoted string value
 */
function escapeYamlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Slugify a project name for use in folder names
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * ProjectPersistence - Handles saving and loading project data to/from disk
 *
 * Manages the project.md file format:
 * - YAML frontmatter for metadata
 * - Markdown body for description
 *
 * Folder structure:
 * copilot/projects/
 * └── [project-id]__[project-name-slug]/
 *     ├── project.md
 *     └── conversations/
 */
export class ProjectPersistence {
  constructor(private app: App) {}

  /**
   * Get the base projects folder path from settings
   */
  private getProjectsFolder(): string {
    return getSettings().projectsPlusFolder;
  }

  /**
   * Get the folder path for a specific project
   */
  getProjectFolderPath(projectId: string, projectName: string): string {
    const slug = slugify(projectName);
    return `${this.getProjectsFolder()}/${projectId}__${slug}`;
  }

  /**
   * Get the project.md file path for a specific project
   */
  getProjectFilePath(projectId: string, projectName: string): string {
    return `${this.getProjectFolderPath(projectId, projectName)}/project.md`;
  }

  /**
   * Migrate existing goal.md files to project.md
   * Called once during initialization
   */
  async migrateStorage(): Promise<void> {
    const projectsFolder = this.getProjectsFolder();
    const folder = this.app.vault.getAbstractFileByPath(projectsFolder);

    if (!(folder instanceof TFolder)) return;

    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;

      const oldPath = `${child.path}/goal.md`;
      const newPath = `${child.path}/project.md`;

      const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
      if (oldFile instanceof TFile) {
        await this.app.fileManager.renameFile(oldFile, newPath);
        logInfo(`[ProjectPersistence] Migrated ${oldPath} to ${newPath}`);
      }
    }
  }

  /**
   * Save a project to disk
   */
  async saveProject(project: Project): Promise<void> {
    try {
      const folderPath = this.getProjectFolderPath(project.id, project.name);
      const filePath = `${folderPath}/project.md`;

      // Ensure project folder exists
      await ensureFolderExists(folderPath);

      // Ensure conversations subfolder exists
      await ensureFolderExists(`${folderPath}/conversations`);

      // Generate content
      const content = this.generateProjectContent(project);

      // Check if file exists
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, content);
        logInfo(`[ProjectPersistence] Updated project file: ${filePath}`);
      } else {
        await this.app.vault.create(filePath, content);
        logInfo(`[ProjectPersistence] Created project file: ${filePath}`);
      }
    } catch (error) {
      logError("[ProjectPersistence] Error saving project:", error);
      throw error;
    }
  }

  /**
   * Load a project from a project.md file path
   */
  async loadProject(projectFilePath: string): Promise<Project | null> {
    try {
      const file = this.app.vault.getAbstractFileByPath(projectFilePath);
      if (!(file instanceof TFile)) {
        logWarn(`[ProjectPersistence] Project file not found: ${projectFilePath}`);
        return null;
      }

      const content = await this.app.vault.read(file);
      return this.parseProjectContent(content);
    } catch (error) {
      logError(`[ProjectPersistence] Error loading project from ${projectFilePath}:`, error);
      return null;
    }
  }

  /**
   * Load all projects from the projects folder
   */
  async loadAllProjects(): Promise<Project[]> {
    const projects: Project[] = [];
    const projectsFolder = this.getProjectsFolder();

    try {
      const folder = this.app.vault.getAbstractFileByPath(projectsFolder);
      if (!(folder instanceof TFolder)) {
        // Projects folder doesn't exist yet
        logInfo(`[ProjectPersistence] Projects folder not found: ${projectsFolder}`);
        return projects;
      }

      // Iterate through subfolders
      for (const child of folder.children) {
        if (!(child instanceof TFolder)) continue;

        // Look for project.md in each subfolder
        const projectFilePath = `${child.path}/project.md`;
        const project = await this.loadProject(projectFilePath);
        if (project) {
          projects.push(project);
        }
      }

      logInfo(`[ProjectPersistence] Loaded ${projects.length} projects`);
      return projects;
    } catch (error) {
      logError("[ProjectPersistence] Error loading all projects:", error);
      return projects;
    }
  }

  /**
   * Delete a project and its folder
   */
  async deleteProject(project: Project): Promise<void> {
    try {
      const folderPath = this.getProjectFolderPath(project.id, project.name);
      const folder = this.app.vault.getAbstractFileByPath(folderPath);

      if (folder instanceof TFolder) {
        // Delete the entire folder recursively
        await this.app.vault.delete(folder, true);
        logInfo(`[ProjectPersistence] Deleted project folder: ${folderPath}`);
      } else {
        logWarn(`[ProjectPersistence] Project folder not found for deletion: ${folderPath}`);
      }
    } catch (error) {
      logError("[ProjectPersistence] Error deleting project:", error);
      throw error;
    }
  }

  /**
   * Rename a project folder when project name changes
   */
  async renameProjectFolder(project: Project, oldName: string): Promise<void> {
    try {
      const oldFolderPath = this.getProjectFolderPath(project.id, oldName);
      const newFolderPath = this.getProjectFolderPath(project.id, project.name);

      if (oldFolderPath === newFolderPath) {
        // No rename needed
        return;
      }

      const oldFolder = this.app.vault.getAbstractFileByPath(oldFolderPath);
      if (oldFolder instanceof TFolder) {
        await this.app.fileManager.renameFile(oldFolder, newFolderPath);
        logInfo(
          `[ProjectPersistence] Renamed project folder: ${oldFolderPath} -> ${newFolderPath}`
        );
      }
    } catch (error) {
      logError("[ProjectPersistence] Error renaming project folder:", error);
      throw error;
    }
  }

  /**
   * Parse project.md content into a Project object
   */
  private parseProjectContent(content: string): Project | null {
    try {
      // Extract YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        logWarn("[ProjectPersistence] No frontmatter found in project file");
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

      // Skip the title line (# Project Name)
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
      logError("[ProjectPersistence] Error parsing project content:", error);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter string into ProjectFrontmatter object
   */
  private parseYamlFrontmatter(yamlStr: string): ProjectFrontmatter | null {
    try {
      const result: Partial<ProjectFrontmatter> = {};

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
        logWarn("[ProjectPersistence] Missing required fields in frontmatter");
        return null;
      }

      return result as ProjectFrontmatter;
    } catch (error) {
      logError("[ProjectPersistence] Error parsing YAML frontmatter:", error);
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
  ): { item: ProjectNote | null; nextIndex: number } {
    const note: Partial<ProjectNote> = {};
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
      return { item: note as ProjectNote, nextIndex: i };
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
   * Generate project.md content with YAML frontmatter
   */
  private generateProjectContent(project: Project): string {
    const notesYaml = this.generateNotesYaml(project.notes);
    const conversationsYaml = this.generateConversationsYaml(project.conversations);

    let frontmatter = `---
id: "${escapeYamlString(project.id)}"
name: "${escapeYamlString(project.name)}"
status: "${project.status}"
createdAt: ${project.createdAt}
updatedAt: ${project.updatedAt}`;

    if (project.completedAt) {
      frontmatter += `\ncompletedAt: ${project.completedAt}`;
    }

    if (project.reflection) {
      frontmatter += `\nreflection: "${escapeYamlString(project.reflection)}"`;
    }

    frontmatter += `\n${notesYaml}`;
    frontmatter += `\n${conversationsYaml}`;
    frontmatter += `\n---`;

    const content = `${frontmatter}

# ${project.name}

${project.description}`;

    return content;
  }

  /**
   * Generate YAML for notes array
   */
  private generateNotesYaml(notes: ProjectNote[]): string {
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
