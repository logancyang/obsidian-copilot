/**
 * UI-layer types for the comment thread overlay.
 */

import type { EditorView } from "@codemirror/view";
import type CopilotPlugin from "@/main";
import type { CommentSessionManager } from "@/comments/CommentSessionManager";
import type { Comment } from "@/comments/types";

export interface CommentThreadPanelOptions {
  plugin: CopilotPlugin;
  view: EditorView;
  notePath: string;
  commentId: string;
  initialComment: Comment;
  sessionManager: CommentSessionManager;
  onClose: () => void;
  onResolveToggle: () => void;
  onDelete: () => void;
  /** Called when the user clicks "Review changes" on a suggested-edit card. */
  onReviewSuggestedEdit: (messageId: string) => void;
}

export interface CommentOverlayPayload {
  /** CM6 document offset the overlay should be anchored below. */
  anchorPos: number;
  options: CommentThreadPanelOptions;
}
