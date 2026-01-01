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

/**
 * Extracted goal data from AI conversation
 */
export interface GoalExtraction {
  /** Extracted goal name (2-8 words, action-oriented) */
  name: string;
  /** Extracted description (what the goal entails) */
  description: string;
  /** AI confidence in extraction (0.0-1.0) */
  confidence: number;
}

/**
 * Message in goal creation conversation
 */
export interface GoalCreationMessage {
  /** Unique message ID */
  id: string;
  /** Message role */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** Message timestamp (epoch ms) */
  timestamp: number;
}

/**
 * State for goal creation flow
 */
export interface GoalCreationState {
  /** Current conversation messages */
  messages: GoalCreationMessage[];
  /** Latest extraction from AI */
  extraction: GoalExtraction | null;
  /** User's manual edits (override AI extraction) */
  manualEdits: Partial<GoalExtraction>;
  /** Whether goal is ready to create (name + description filled) */
  isReady: boolean;
  /** Whether currently streaming AI response */
  isStreaming: boolean;
  /** Any error message */
  error: string | null;
}
