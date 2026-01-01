import { logError, logInfo } from "@/logger";
import {
  Goal,
  GoalStatus,
  CreateGoalInput,
  UpdateGoalInput,
  GoalNote,
} from "@/types/projects-plus";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { GoalPersistence } from "./GoalPersistence";

/**
 * GoalManager - Central business logic coordinator for goals
 *
 * Orchestrates GoalPersistence and provides:
 * - CRUD operations for goals
 * - State management with listeners
 * - Goal filtering and searching
 */
export class GoalManager {
  private goals: Map<string, Goal> = new Map();
  private listeners: Set<() => void> = new Set();
  private persistence: GoalPersistence;
  private initialized: boolean = false;

  constructor(private app: App) {
    this.persistence = new GoalPersistence(app);
  }

  /**
   * Initialize the manager by loading all goals from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const goals = await this.persistence.loadAllGoals();
      for (const goal of goals) {
        this.goals.set(goal.id, goal);
      }
      this.initialized = true;
      logInfo(`[GoalManager] Initialized with ${goals.length} goals`);
    } catch (error) {
      logError("[GoalManager] Error initializing:", error);
      throw error;
    }
  }

  /**
   * Subscribe to goal changes
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
        logError("[GoalManager] Error in listener:", error);
      }
    }
  }

  /**
   * Create a new goal
   */
  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const now = Date.now();
    const goal: Goal = {
      id: uuidv4(),
      name: input.name,
      description: input.description,
      status: "active",
      notes: [],
      conversations: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.persistence.saveGoal(goal);
      this.goals.set(goal.id, goal);
      this.notifyListeners();
      logInfo(`[GoalManager] Created goal: ${goal.name}`);
      return goal;
    } catch (error) {
      logError("[GoalManager] Error creating goal:", error);
      throw error;
    }
  }

  /**
   * Update an existing goal
   */
  async updateGoal(id: string, updates: UpdateGoalInput): Promise<Goal | null> {
    const goal = this.goals.get(id);
    if (!goal) {
      logError(`[GoalManager] Goal not found: ${id}`);
      return null;
    }

    const oldName = goal.name;
    const updatedGoal: Goal = {
      ...goal,
      ...updates,
      updatedAt: Date.now(),
    };

    try {
      // If name changed, rename the folder first
      if (updates.name && updates.name !== oldName) {
        await this.persistence.renameGoalFolder(updatedGoal, oldName);
      }

      await this.persistence.saveGoal(updatedGoal);
      this.goals.set(id, updatedGoal);
      this.notifyListeners();
      logInfo(`[GoalManager] Updated goal: ${updatedGoal.name}`);
      return updatedGoal;
    } catch (error) {
      logError("[GoalManager] Error updating goal:", error);
      throw error;
    }
  }

  /**
   * Delete a goal
   */
  async deleteGoal(id: string): Promise<boolean> {
    const goal = this.goals.get(id);
    if (!goal) {
      logError(`[GoalManager] Goal not found: ${id}`);
      return false;
    }

    try {
      await this.persistence.deleteGoal(goal);
      this.goals.delete(id);
      this.notifyListeners();
      logInfo(`[GoalManager] Deleted goal: ${goal.name}`);
      return true;
    } catch (error) {
      logError("[GoalManager] Error deleting goal:", error);
      throw error;
    }
  }

  /**
   * Get all goals
   */
  getAllGoals(): Goal[] {
    return Array.from(this.goals.values());
  }

  /**
   * Get goals filtered by status
   */
  getGoalsByStatus(status: GoalStatus): Goal[] {
    return this.getAllGoals().filter((goal) => goal.status === status);
  }

  /**
   * Get a specific goal by ID
   */
  getGoal(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  /**
   * Mark a goal as completed
   */
  async completeGoal(id: string, reflection?: string): Promise<Goal | null> {
    const updates: UpdateGoalInput = {
      status: "completed",
    };
    if (reflection) {
      updates.reflection = reflection;
    }

    const goal = this.goals.get(id);
    if (!goal) {
      return null;
    }

    const updatedGoal: Goal = {
      ...goal,
      ...updates,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveGoal(updatedGoal);
      this.goals.set(id, updatedGoal);
      this.notifyListeners();
      logInfo(`[GoalManager] Completed goal: ${updatedGoal.name}`);
      return updatedGoal;
    } catch (error) {
      logError("[GoalManager] Error completing goal:", error);
      throw error;
    }
  }

  /**
   * Archive a goal
   */
  async archiveGoal(id: string): Promise<Goal | null> {
    return this.updateGoal(id, { status: "archived" });
  }

  /**
   * Reactivate a completed or archived goal
   */
  async reactivateGoal(id: string): Promise<Goal | null> {
    const goal = this.goals.get(id);
    if (!goal) {
      return null;
    }

    const updatedGoal: Goal = {
      ...goal,
      status: "active",
      completedAt: undefined,
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveGoal(updatedGoal);
      this.goals.set(id, updatedGoal);
      this.notifyListeners();
      logInfo(`[GoalManager] Reactivated goal: ${updatedGoal.name}`);
      return updatedGoal;
    } catch (error) {
      logError("[GoalManager] Error reactivating goal:", error);
      throw error;
    }
  }

  /**
   * Add a note to a goal
   */
  async addNoteToGoal(
    goalId: string,
    notePath: string,
    manuallyAdded: boolean,
    relevanceScore?: number
  ): Promise<Goal | null> {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return null;
    }

    // Check if note already exists
    if (goal.notes.some((n) => n.path === notePath)) {
      logInfo(`[GoalManager] Note already assigned: ${notePath}`);
      return goal;
    }

    const note: GoalNote = {
      path: notePath,
      assignedAt: Date.now(),
      relevanceScore,
      manuallyAdded,
    };

    const updatedGoal: Goal = {
      ...goal,
      notes: [...goal.notes, note],
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveGoal(updatedGoal);
      this.goals.set(goalId, updatedGoal);
      this.notifyListeners();
      logInfo(`[GoalManager] Added note to goal: ${notePath}`);
      return updatedGoal;
    } catch (error) {
      logError("[GoalManager] Error adding note to goal:", error);
      throw error;
    }
  }

  /**
   * Remove a note from a goal
   */
  async removeNoteFromGoal(goalId: string, notePath: string): Promise<Goal | null> {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return null;
    }

    const updatedGoal: Goal = {
      ...goal,
      notes: goal.notes.filter((n) => n.path !== notePath),
      updatedAt: Date.now(),
    };

    try {
      await this.persistence.saveGoal(updatedGoal);
      this.goals.set(goalId, updatedGoal);
      this.notifyListeners();
      logInfo(`[GoalManager] Removed note from goal: ${notePath}`);
      return updatedGoal;
    } catch (error) {
      logError("[GoalManager] Error removing note from goal:", error);
      throw error;
    }
  }

  /**
   * Search goals by name or description
   */
  searchGoals(query: string): Goal[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllGoals().filter(
      (goal) =>
        goal.name.toLowerCase().includes(lowerQuery) ||
        goal.description.toLowerCase().includes(lowerQuery)
    );
  }
}
