/**
 * Shared layout constants for command-ui modals.
 *
 * These values are used by both the initial positioning logic
 * (CustomCommandChatModal.getInitialPosition) and the runtime modal
 * (MenuCommandModal / DraggableModal). Keeping them in one place
 * prevents silent drift when headers, footers, or content areas change.
 */

/** Minimum modal height when ContentArea is hidden (compact / idle Quick Command). */
export const MODAL_MIN_HEIGHT_COMPACT = 180;

/** Minimum modal height when ContentArea is visible (expanded / custom commands). */
export const MODAL_MIN_HEIGHT_EXPANDED = 400;
