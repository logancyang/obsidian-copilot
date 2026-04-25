/**
 * Shared types for the inline Copilot comments feature.
 */

export type CommentState = "active" | "resolved" | "orphaned";

/**
 * Multi-tier anchor that allows a comment to be re-attached to text
 * even after the host note has been edited.
 */
export interface CommentAnchor {
  /** The exact highlighted text at the time the comment was created. */
  exactText: string;
  /** Up to N characters preceding the highlight (for disambiguation). */
  prefix: string;
  /** Up to N characters following the highlight (for disambiguation). */
  suffix: string;
  /** 0-based line at the start of the original highlight. */
  startLine: number;
  /** 0-based column at the start of the original highlight. */
  startCh: number;
  /** 0-based line at the end of the original highlight. */
  endLine: number;
  /** 0-based column at the end of the original highlight. */
  endCh: number;
  /** Document length when the anchor was captured (used to scale offsets). */
  docLengthAtCapture: number;
}

export interface SuggestedEdit {
  proposedText: string;
  status: "pending" | "accepted" | "rejected";
  acceptedAt?: number;
  rejectedAt?: number;
}

export interface CommentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  suggestedEdit?: SuggestedEdit;
}

export interface Comment {
  id: string;
  anchor: CommentAnchor;
  state: CommentState;
  messages: CommentMessage[];
  createdAt: number;
  updatedAt: number;
  modelKey?: string;
}

export interface CommentSidecar {
  version: 1;
  stableId: string;
  notePath: string;
  createdAt: number;
  updatedAt: number;
  comments: Comment[];
}
