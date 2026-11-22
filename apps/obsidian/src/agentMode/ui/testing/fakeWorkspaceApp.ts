import type { App, EventRef } from "obsidian";

export interface FakeWorkspaceApp {
  app: App;
  setLeaves: (leavesByViewType: Record<string, number>) => void;
  layoutListenerCount: () => number;
}

export function makeFakeWorkspaceApp(): FakeWorkspaceApp {
  let leavesByViewType: Record<string, number> = {};
  const listenersByRef = new Map<EventRef, () => void>();
  const app = {
    workspace: {
      getLeavesOfType: (viewType: string): object[] =>
        Array.from({ length: leavesByViewType[viewType] ?? 0 }, () => ({})),
      on: (_event: string, listener: () => void) => {
        const ref = {} as EventRef;
        listenersByRef.set(ref, listener);
        return ref;
      },
      offref: (ref: EventRef) => {
        listenersByRef.delete(ref);
      },
    },
  } as unknown as App;
  return {
    app,
    setLeaves: (next) => {
      leavesByViewType = next;
      for (const listener of listenersByRef.values()) listener();
    },
    layoutListenerCount: () => listenersByRef.size,
  };
}
