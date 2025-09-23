/**
 * Plugin to register NotePillNode with the editor.
 * Deletion logic has been moved to PillDeletionPlugin for better scalability.
 */
export function NotePillPlugin(): null {
  // This plugin now only handles node registration
  // All deletion logic is handled by the centralized PillDeletionPlugin
  return null;
}

// Re-export NotePillNode and utility functions for backward compatibility
export {
  NotePillNode,
  $createNotePillNode,
  $isNotePillNode,
  $findNotePills,
  $removePillsByPath,
  type SerializedNotePillNode,
} from "../pills/NotePillNode";
