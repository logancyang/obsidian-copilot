import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import type { App, TFile } from "obsidian";

let mockAutoAddActiveContent = false;
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ autoAddActiveContentToContext: mockAutoAddActiveContent }),
}));

// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- minimal path-only stub for draft state tests
const file = (path: string): TFile => ({ path }) as unknown as TFile;

function buildStore({ live = ["a"], activeFile = null as TFile | null } = {}) {
  const liveIds = new Set(live);
  const app = { workspace: { getActiveFile: () => activeFile } } as unknown as App;
  const store = new AgentInputDraftStore(app, (id) => liveIds.has(id));
  return { store, liveIds };
}

describe("AgentInputDraftStore", () => {
  afterEach(() => {
    mockAutoAddActiveContent = false;
  });

  describe("AgentInputDraftStore", () => {
    describe("get()", () => {
      it("returns nothing for a chat input that has never been written", () => {
        const { store } = buildStore();

        expect(store.get("a")).toBeUndefined();
      });
    });

    describe("update()", () => {
      it("seeds a first write from the include-active-note setting", () => {
        mockAutoAddActiveContent = true;
        const { store } = buildStore();

        store.update("a", (draft) => ({ ...draft, input: "hello" }));

        expect(store.get("a")).toEqual({
          input: "hello",
          images: [],
          contextNotes: [],
          includeActiveNote: true,
          includeActiveWebTab: false,
          loading: false,
          queue: [],
        });
      });

      it("notifies subscribers only when the draft changes", () => {
        const { store } = buildStore();
        const listener = jest.fn();
        store.subscribe(listener);

        store.update("a", (draft) => ({ ...draft, input: "hello" }));
        store.update("a", (draft) => draft);

        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("drops a write to a chat input the manager no longer owns", () => {
        const { store } = buildStore({ live: [] });

        store.update("a", (draft) => ({ ...draft, input: "late turn result" }));

        expect(store.get("a")).toBeUndefined();
      });
    });

    describe("addContextNote()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 appends a note once, keeping existing attachments", () => {
        const { store } = buildStore();
        const existing = file("Existing.md");
        const clicked = file("Clicked.md");
        store.update("a", (draft) => ({ ...draft, contextNotes: [existing] }));

        store.addContextNote("a", clicked);
        store.addContextNote("a", clicked);

        expect(store.get("a")?.contextNotes).toEqual([existing, clicked]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 replaces the dynamic Active Note badge when the added note is the active note", () => {
        mockAutoAddActiveContent = true;
        const clicked = file("Clicked.md");
        const { store } = buildStore({ activeFile: clicked });

        store.addContextNote("a", clicked);

        expect(store.get("a")?.includeActiveNote).toBe(false);
        expect(store.get("a")?.contextNotes).toEqual([clicked]);
      });

      it("keeps the Active Note badge when the added note is a different note", () => {
        mockAutoAddActiveContent = true;
        const { store } = buildStore({ activeFile: file("Open.md") });

        store.addContextNote("a", file("Other.md"));

        expect(store.get("a")?.includeActiveNote).toBe(true);
      });
    });

    describe("prune()", () => {
      it("drops drafts for chat inputs that are no longer live and keeps the rest", () => {
        const { store, liveIds } = buildStore({ live: ["a", "b"] });
        store.update("a", (draft) => ({ ...draft, input: "a text" }));
        store.update("b", (draft) => ({ ...draft, input: "b text" }));
        liveIds.delete("a");

        store.prune();

        expect(store.get("a")).toBeUndefined();
        expect(store.get("b")?.input).toBe("b text");
      });
    });

    describe("subscribe()", () => {
      it("stops notifying after the returned unsubscribe runs", () => {
        const { store } = buildStore();
        const listener = jest.fn();
        const unsubscribe = store.subscribe(listener);

        unsubscribe();
        store.update("a", (draft) => ({ ...draft, input: "hello" }));

        expect(listener).not.toHaveBeenCalled();
      });
    });
  });
});
