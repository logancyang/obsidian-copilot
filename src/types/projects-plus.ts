/**
 * Projects+ Type Definitions
 *
 * Types for the goal-oriented workspace feature.
 */

/**
 * Goal status enum
 */
export type GoalStatus = "active" | "completed" | "archived";

/**
 * Reference to a note assigned to a goal
 */
export interface GoalNote {
  /** Path to the note in the vault */
  path: string;
  /** When the note was assigned */
  assignedAt: number;
  /** Optional relevance score from AI analysis (0-1) */
  relevanceScore?: number;
  /** Whether the user manually added this note */
  manuallyAdded: boolean;
}

/**
 * Reference to a conversation associated with a goal
 */
export interface ConversationRef {
  /** Unique conversation ID */
  id: string;
  /** Title/topic of the conversation */
  title: string;
  /** Path to the conversation file relative to goal folder */
  path: string;
  /** When the conversation was created */
  createdAt: number;
  /** Number of messages in the conversation */
  messageCount: number;
}

/**
 * Main Goal interface
 */
export interface Goal {
  /** Unique identifier (UUID) */
  id: string;
  /** Goal name/title */
  name: string;
  /** Detailed description (markdown supported) */
  description: string;
  /** Current status */
  status: GoalStatus;
  /** Assigned notes */
  notes: GoalNote[];
  /** Associated conversations */
  conversations: ConversationRef[];
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
  /** Completion timestamp (only for completed goals, epoch ms) */
  completedAt?: number;
  /** Reflection notes upon completion */
  reflection?: string;
}

/**
 * Goal creation input (without system-generated fields)
 */
export type CreateGoalInput = Pick<Goal, "name" | "description">;

/**
 * Goal update input
 */
export type UpdateGoalInput = Partial<Pick<Goal, "name" | "description" | "status" | "reflection">>;

/**
 * Goal frontmatter structure for YAML serialization
 */
export interface GoalFrontmatter {
  id: string;
  name: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reflection?: string;
  notes: GoalNote[];
  conversations: ConversationRef[];
}
