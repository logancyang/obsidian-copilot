/**
 * Projects+ Type Definitions
 *
 * Types for the project-oriented workspace feature.
 */

/**
 * Project status enum
 */
export type ProjectStatus = "active" | "completed" | "archived";

/**
 * Reference to a note assigned to a project
 */
export interface ProjectNote {
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
 * Reference to a conversation associated with a project
 */
export interface ConversationRef {
  /** Unique conversation ID */
  id: string;
  /** Title/topic of the conversation */
  title: string;
  /** Path to the conversation file relative to project folder */
  path: string;
  /** When the conversation was created */
  createdAt: number;
  /** Number of messages in the conversation */
  messageCount: number;
}

/**
 * Main Project interface
 */
export interface Project {
  /** Unique identifier (UUID) */
  id: string;
  /** Project name/title */
  name: string;
  /** Detailed description (markdown supported) */
  description: string;
  /** Current status */
  status: ProjectStatus;
  /** Assigned notes */
  notes: ProjectNote[];
  /** Associated conversations */
  conversations: ConversationRef[];
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
  /** Completion timestamp (only for completed projects, epoch ms) */
  completedAt?: number;
  /** Reflection notes upon completion */
  reflection?: string;
}

/**
 * Project creation input (without system-generated fields)
 */
export type CreateProjectInput = Pick<Project, "name" | "description">;

/**
 * Project update input
 */
export type UpdateProjectInput = Partial<
  Pick<Project, "name" | "description" | "status" | "reflection">
>;

/**
 * Project frontmatter structure for YAML serialization
 */
export interface ProjectFrontmatter {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reflection?: string;
  notes: ProjectNote[];
  conversations: ConversationRef[];
}

/**
 * Extracted project data from AI conversation
 */
export interface ProjectExtraction {
  /** Extracted project name (2-8 words, action-oriented) */
  name: string;
  /** Extracted description (what the project entails) */
  description: string;
  /** AI confidence in extraction (0.0-1.0) */
  confidence: number;
}

/**
 * Message in project creation conversation
 */
export interface ProjectCreationMessage {
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
 * State for project creation flow
 */
export interface ProjectCreationState {
  /** Current conversation messages */
  messages: ProjectCreationMessage[];
  /** Latest extraction from AI */
  extraction: ProjectExtraction | null;
  /** User's manual edits (override AI extraction) */
  manualEdits: Partial<ProjectExtraction>;
  /** Whether project is ready to create (name + description filled) */
  isReady: boolean;
  /** Whether currently streaming AI response */
  isStreaming: boolean;
  /** Any error message */
  error: string | null;
}
