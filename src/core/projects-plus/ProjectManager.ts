import { logError, logInfo } from "@/logger";
import {
  Project,
  ProjectStatus,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectNote,
} from "@/types/projects-plus";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { ProjectPersistence } from "./ProjectPersistence";

/**
 * ProjectManager - Central business logic coordinator for projects
 *
 * Orchestrates ProjectPersistence and provides:
 * - CRUD operations for projects
 * - State management with listeners
 * - Project filtering and searching
 */
export class ProjectManager {
  private projects: Map<string, Project> = new Map();
  private listeners: Set<() => void> = new Set();
  private persistence: ProjectPersistence;
  private initialized: boolean = false;

  constructor(private app: App) {
    this.persistence = new ProjectPersistence(app);
  }

  /**
   * Initialize the manager by loading all projects from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Migrate any existing goal.md files to project.md
      await this.persistence.migrateStorage();

      const projects = await this.persistence.loadAllProjects();
      for (const project of projects) {
        this.projects.set(project.id, project);
      }
      this.initialized = true;
      logInfo(`[ProjectManager] Initialized with ${projects.length} projects`);
    } catch (error) {
      logError("[ProjectManager] Error initializing:", error);
      throw error;
    }
  }

  /**
   * Subscribe to project changes
   * @returns Unsubscribe function
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logError("[ProjectManager] Error in listener:", error);
      }
    }
  }

  /**
   * Create a new project
   */
  async createProject(input: CreateProjectInput): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: uuidv4(),
      title: input.title,
      description: input.description,
      successCriteria: input.successCriteria,
      deadline: input.deadline,
      status: "active",
      notes: [],
      conversations: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.persistence.saveProject(project);
      this.projects.set(project.id, project);
      this.notifyListeners();
      logInfo(`[ProjectManager] Created project: ${project.title}`);
      return project;
    } catch (error) {
      logError("[ProjectManager] Error creating project:", error);
      throw error;
    }
  }

  /**
   * Update an existing project
   */
  async updateProject(id: string, updates: UpdateProjectInput): Promise<Project | null> {
    const project = this.projects.get(id);
    if (!project) {
      logError(`[ProjectManager] Project not found: ${id}`);
      return null;
    }

    const oldTitle = project.title;
    const updatedProject: Project = {
      ...project,
      ...updates,
      updatedAt: Date.now(),
    };

    try {
      // If title changed, rename the folder first
      if (updates.title && updates.title !== oldTitle) {
        await this.persistence.renameProjectFolder(updatedProject, oldTitle);
      }

      await this.persistence.saveProject(updatedProject);
      this.projects.set(id, updatedProject);
      this.notifyListeners();
      logInfo(`[ProjectManager] Updated project: ${updatedProject.title}`);
      return updatedProject;
    } catch (error) {
      logError("[ProjectManager] Error updating project:", error);
      throw error;
    }
  }

  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<boolean> {
    const project = this.projects.get(id);
    if (!project) {
      logError(`[ProjectManager] Project not found: ${id}`);
      return false;
    }

    try {
      await this.persistence.deleteProject(project);
      this.projects.delete(id);
      this.notifyListeners();
      logInfo(`[ProjectManager] Deleted project: ${project.title}`);
      return true;
    } catch (error) {
      logError("[ProjectManager] Error deleting project:", error);
      throw error;
    }
  }

  /**
   * Get all projects
   */
  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  /**
   * Get projects filtered by status
   */
  getProjectsByStatus(status: ProjectStatus): Project[] {
    return this.getAllProjects().filter((project) => project.status === status);
  }

  /**
   * Get a specific project by ID
   */
  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  /**
   * Mark a project as completed
   */
  async completeProject(id: string, reflection?: string): Promise<Project | null> {
    const updates: UpdateProjectInput = {
      status: "completed",
    };
    if (reflection) {
      updates.reflection = reflection;
    }

    const project = this.projects.get(id);
    if (!project) {
      return null;
    }

    const updatedProject: Project = {
      ...project,
      ...updates,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveProject(updatedProject);
      this.projects.set(id, updatedProject);
      this.notifyListeners();
      logInfo(`[ProjectManager] Completed project: ${updatedProject.title}`);
      return updatedProject;
    } catch (error) {
      logError("[ProjectManager] Error completing project:", error);
      throw error;
    }
  }

  /**
   * Archive a project
   */
  async archiveProject(id: string): Promise<Project | null> {
    return this.updateProject(id, { status: "archived" });
  }

  /**
   * Reactivate a completed or archived project
   */
  async reactivateProject(id: string): Promise<Project | null> {
    const project = this.projects.get(id);
    if (!project) {
      return null;
    }

    const updatedProject: Project = {
      ...project,
      status: "active",
      completedAt: undefined,
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveProject(updatedProject);
      this.projects.set(id, updatedProject);
      this.notifyListeners();
      logInfo(`[ProjectManager] Reactivated project: ${updatedProject.title}`);
      return updatedProject;
    } catch (error) {
      logError("[ProjectManager] Error reactivating project:", error);
      throw error;
    }
  }

  /**
   * Add a note to a project
   */
  async addNoteToProject(
    projectId: string,
    notePath: string,
    manuallyAdded: boolean,
    relevanceScore?: number
  ): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project) {
      return null;
    }

    // Check if note already exists
    if (project.notes.some((n) => n.path === notePath)) {
      logInfo(`[ProjectManager] Note already assigned: ${notePath}`);
      return project;
    }

    const note: ProjectNote = {
      path: notePath,
      assignedAt: Date.now(),
      relevanceScore,
      manuallyAdded,
    };

    const updatedProject: Project = {
      ...project,
      notes: [...project.notes, note],
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveProject(updatedProject);
      this.projects.set(projectId, updatedProject);
      this.notifyListeners();
      logInfo(`[ProjectManager] Added note to project: ${notePath}`);
      return updatedProject;
    } catch (error) {
      logError("[ProjectManager] Error adding note to project:", error);
      throw error;
    }
  }

  /**
   * Add multiple notes to a project at once
   * @param projectId - The project ID
   * @param notePaths - Array of note paths to add
   * @param relevanceScores - Optional map of path -> score for AI-suggested notes
   * @returns Updated project or null if project not found
   */
  async addNotesToProject(
    projectId: string,
    notePaths: string[],
    relevanceScores?: Map<string, number>
  ): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project) {
      return null;
    }

    // Filter out already-assigned notes
    const existingPaths = new Set(project.notes.map((n) => n.path));
    const newPaths = notePaths.filter((path) => !existingPaths.has(path));

    if (newPaths.length === 0) {
      logInfo("[ProjectManager] All notes already assigned");
      return project;
    }

    const now = Date.now();
    const newNotes: ProjectNote[] = newPaths.map((path) => ({
      path,
      assignedAt: now,
      relevanceScore: relevanceScores?.get(path),
      manuallyAdded: false, // AI-suggested notes
    }));

    const updatedProject: Project = {
      ...project,
      notes: [...project.notes, ...newNotes],
      updatedAt: now,
    };

    try {
      await this.persistence.saveProject(updatedProject);
      this.projects.set(projectId, updatedProject);
      this.notifyListeners();
      logInfo(`[ProjectManager] Added ${newNotes.length} notes to project`);
      return updatedProject;
    } catch (error) {
      logError("[ProjectManager] Error adding notes to project:", error);
      throw error;
    }
  }

  /**
   * Remove a note from a project
   */
  async removeNoteFromProject(projectId: string, notePath: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project) {
      return null;
    }

    const updatedProject: Project = {
      ...project,
      notes: project.notes.filter((n) => n.path !== notePath),
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveProject(updatedProject);
      this.projects.set(projectId, updatedProject);
      this.notifyListeners();
      logInfo(`[ProjectManager] Removed note from project: ${notePath}`);
      return updatedProject;
    } catch (error) {
      logError("[ProjectManager] Error removing note from project:", error);
      throw error;
    }
  }

  /**
   * Search projects by title or description
   */
  searchProjects(query: string): Project[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllProjects().filter(
      (project) =>
        project.title.toLowerCase().includes(lowerQuery) ||
        project.description.toLowerCase().includes(lowerQuery)
    );
  }
}
