const COPILOT_COLLAPSIBLE_DOM_ID_PREFIX = "copilot-collapsible";

declare global {
  interface Window {
    __copilotCollapsibleStates?: Map<string, Map<string, boolean>>;
  }
}

const getCollapsibleStateRegistry = (): Map<string, Map<string, boolean>> => {
  if (!window.__copilotCollapsibleStates) {
    window.__copilotCollapsibleStates = new Map<string, Map<string, boolean>>();
  }
  return window.__copilotCollapsibleStates;
};

export const getMessageCollapsibleStates = (messageId: string): Map<string, boolean> => {
  const registry = getCollapsibleStateRegistry();
  let states = registry.get(messageId);
  if (!states) {
    states = new Map<string, boolean>();
    registry.set(messageId, states);
  }
  return states;
};

export const buildCopilotCollapsibleDomId = (
  messageInstanceId: string,
  sectionKey: string
): string => {
  const safeMessageId = messageInstanceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${COPILOT_COLLAPSIBLE_DOM_ID_PREFIX}-${safeMessageId}-${sectionKey}`;
};

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
    if (!overwriteExisting && stateById.has(id)) {
      return;
    }
    stateById.set(id, details.open);
  });
};

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
  if (details?.instanceOf(HTMLElement) && details.tagName === "DETAILS" && root.contains(details)) {
    return details as HTMLDetailsElement;
  }

  return null;
};

export const isEventWithinDetailsSummary = (event: Event, details: HTMLDetailsElement): boolean => {
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
