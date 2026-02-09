/**
 * Lightweight pub-sub for index state changes (clear, build, reindex).
 * UI hooks subscribe via {@link onIndexChanged} and re-check index state
 * when any command fires {@link notifyIndexChanged}.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to index change events. Returns an unsubscribe function. */
export function onIndexChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify all subscribers that the index state has changed. */
export function notifyIndexChanged(): void {
  listeners.forEach((l) => l());
}
