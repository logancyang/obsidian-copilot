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
  /** Project title */
  title: string;
  /** Detailed description (markdown supported) */
  description: string;
  /** Success criteria - list of measurable outcomes */
  successCriteria: string[];
  /** Optional deadline (epoch ms) */
  deadline?: number;
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
export type CreateProjectInput = Pick<
  Project,
  "title" | "description" | "successCriteria" | "deadline"
>;

/**
 * Project update input
 */
export type UpdateProjectInput = Partial<
  Pick<Project, "title" | "description" | "successCriteria" | "deadline" | "status" | "reflection">
>;

/**
 * Project frontmatter structure for YAML serialization
 */
export interface ProjectFrontmatter {
  id: string;
  title: string;
  successCriteria: string[];
  deadline?: number;
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
  /** Extracted project title (2-8 words, action-oriented) */
  title: string;
  /** Extracted description (what the project entails) */
  description: string;
  /** Success criteria extracted from conversation */
  successCriteria: string[];
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

// ============================================================================
// Note Assignment Types (Phase 3)
// ============================================================================

/**
 * Source of the match for a note suggestion
 */
export type MatchSource = "semantic" | "lexical" | "hybrid";

/**
 * A suggested note from AI-powered search
 */
export interface NoteSuggestion {
  /** Full path to the note in the vault */
  path: string;
  /** Note title (basename without extension) */
  title: string;
  /** Aggregated relevance score (0-1) */
  relevanceScore: number;
  /** Preview excerpt from the most relevant chunk */
  excerpt: string;
  /** Tags from the note */
  tags: string[];
  /** Last modified timestamp (epoch ms) */
  mtime: number;
  /** Source of the match (semantic, lexical, or both) */
  matchSource: MatchSource;
}

/**
 * Result from note assignment search
 */
export interface NoteAssignmentResult {
  /** Suggested notes, ranked by relevance */
  suggestions: NoteSuggestion[];
  /** The search query that was generated from project context */
  generatedQuery: string;
  /** Total notes searched (for user feedback) */
  totalSearched: number;
  /** Whether the search completed successfully */
  success: boolean;
  /** Error message if search failed */
  error?: string;
}

/**
 * Options for note assignment search
 */
export interface NoteAssignmentOptions {
  /** Minimum relevance score to include (default: 0.4) */
  minScore?: number;
  /** Maximum number of suggestions to return (default: 50, safety cap) */
  maxSuggestions?: number;
  /** Whether to skip global exclusions (default: false) */
  ignoreExclusions?: boolean;
}
