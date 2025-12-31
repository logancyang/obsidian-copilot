export const COPILOT_COLLAPSIBLE_DOM_ID_PREFIX = "copilot-collapsible";

declare global {
  interface Window {
    __copilotCollapsibleStates?: Map<string, Map<string, boolean>>;
  }
}

/**
 * Retrieve the global registry that keeps track of collapsible section states.
 * The registry is stored on `window` to preserve state across component lifecycles,
 * ensuring that user's collapse/expand preferences persist when streaming messages
 * transition to final messages.
 */
const getCollapsibleStateRegistry = (): Map<string, Map<string, boolean>> => {
  if (!window.__copilotCollapsibleStates) {
    window.__copilotCollapsibleStates = new Map<string, Map<string, boolean>>();
  }
  return window.__copilotCollapsibleStates;
};

/**
 * Get the collapsible state map for a specific message.
 * Creates a new map if it doesn't exist.
 */
export const getMessageCollapsibleStates = (messageId: string): Map<string, boolean> => {
  const registry = getCollapsibleStateRegistry();
  let states = registry.get(messageId);
  if (!states) {
    states = new Map<string, boolean>();
    registry.set(messageId, states);
  }
  return states;
};

/**
 * Builds a stable DOM id for a collapsible section within a message.
 * Includes messageId to ensure uniqueness across messages.
 */
export const buildCopilotCollapsibleDomId = (
  messageInstanceId: string,
  sectionKey: string
): string => {
  // Normalize messageId to be safe for DOM id attribute
  const safeMessageId = messageInstanceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${COPILOT_COLLAPSIBLE_DOM_ID_PREFIX}-${safeMessageId}-${sectionKey}`;
};

/**
 * Captures the open/closed state for Copilot-rendered collapsible sections.
 * Used to persist user toggles across markdown re-renders during streaming.
 */
export const captureCopilotCollapsibleOpenStates = (
  root: HTMLElement,
  stateById: Map<string, boolean>,
  options: { overwriteExisting?: boolean } = {}
): void => {
  const overwriteExisting = options.overwriteExisting ?? true;
  const detailsList = root.querySelectorAll<HTMLDetailsElement>(
    `details[id^="${COPILOT_COLLAPSIBLE_DOM_ID_PREFIX}-"]`
  );
  detailsList.forEach((details) => {
    const id = details.id;
    if (!id) {
      return;
    }
    // During streaming, don't overwrite user's explicit state changes
    if (!overwriteExisting && stateById.has(id)) {
      return;
    }
    stateById.set(id, details.open);
  });
};

/**
 * Returns the Copilot collapsible <details> element associated with an event.
 * Uses composedPath() when available to remain robust against retargeting.
 */
export const getCopilotCollapsibleDetailsFromEvent = (
  event: Event,
  root: HTMLElement
): HTMLDetailsElement | null => {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    if (entry instanceof HTMLElement && entry.tagName === "DETAILS") {
      const details = entry as HTMLDetailsElement;
      if (
        details.id.startsWith(`${COPILOT_COLLAPSIBLE_DOM_ID_PREFIX}-`) &&
        root.contains(details)
      ) {
        return details;
      }
    }
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const details = target.closest(`details[id^="${COPILOT_COLLAPSIBLE_DOM_ID_PREFIX}-"]`);
  if (details instanceof HTMLElement && details.tagName === "DETAILS" && root.contains(details)) {
    return details as HTMLDetailsElement;
  }

  return null;
};

/**
 * Returns true when the event originated from the <summary> of the given <details>.
 */
export const isEventWithinDetailsSummary = (
  event: Event,
  details: HTMLDetailsElement
): boolean => {
  const summary = details.querySelector("summary");
  if (!summary) {
    return false;
  }

  const target = event.target;
  if (target instanceof Node) {
    return summary.contains(target);
  }

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path.includes(summary);
};
