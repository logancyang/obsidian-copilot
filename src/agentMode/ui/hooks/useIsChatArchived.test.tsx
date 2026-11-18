import { useIsChatArchived } from "@/agentMode/ui/hooks/useIsChatArchived";
import { AppContext } from "@/context";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";

type ChangedListener = (file: { path: string }) => void;

function makeApp(frontmatterByPath: Record<string, Record<string, unknown>>) {
  const listeners = new Set<ChangedListener>();
  const app = {
    metadataCache: {
      getCache: (path: string) =>
        path in frontmatterByPath ? { frontmatter: frontmatterByPath[path] } : null,
      on: (_event: "changed", listener: ChangedListener) => {
        listeners.add(listener);
        return listener;
      },
      offref: (ref: ChangedListener) => listeners.delete(ref),
    },
  } as unknown as App;
  const change = (path: string, frontmatter: Record<string, unknown>) => {
    frontmatterByPath[path] = frontmatter;
    for (const listener of listeners) listener({ path });
  };
  return { app, change, listenerCount: () => listeners.size };
}

function renderArchived(app: App, notePath: string | undefined) {
  return renderHook(({ path }: { path: string | undefined }) => useIsChatArchived(path), {
    initialProps: { path: notePath },
    wrapper: ({ children }) => <AppContext.Provider value={app}>{children}</AppContext.Provider>,
  });
}

describe("useIsChatArchived", () => {
  describe("useIsChatArchived()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/968 reports a chat note with an archivedAt time as archived", () => {
      const { app } = makeApp({ "chats/a.md": { archivedAt: 7_000 } });

      expect(renderArchived(app, "chats/a.md").result.current).toBe(true);
    });

    it("reports a chat note without an archivedAt time as not archived", () => {
      const { app } = makeApp({ "chats/a.md": { topic: "Plan" } });

      expect(renderArchived(app, "chats/a.md").result.current).toBe(false);
    });

    it("reports a chat with no saved note as not archived", () => {
      const { app } = makeApp({});

      expect(renderArchived(app, undefined).result.current).toBe(false);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/968 follows the note as it is archived and unarchived elsewhere", () => {
      const { app, change } = makeApp({ "chats/a.md": {} });
      const { result } = renderArchived(app, "chats/a.md");

      act(() => change("chats/a.md", { archivedAt: 7_000 }));
      expect(result.current).toBe(true);

      act(() => change("chats/a.md", {}));
      expect(result.current).toBe(false);
    });

    it("ignores changes to other notes", () => {
      const { app, change } = makeApp({ "chats/a.md": {}, "chats/b.md": {} });
      const { result } = renderArchived(app, "chats/a.md");

      act(() => change("chats/b.md", { archivedAt: 7_000 }));

      expect(result.current).toBe(false);
    });

    it("stops listening for note changes once unmounted", () => {
      const { app, listenerCount } = makeApp({ "chats/a.md": {} });
      const { unmount } = renderArchived(app, "chats/a.md");

      unmount();

      expect(listenerCount()).toBe(0);
    });
  });
});
