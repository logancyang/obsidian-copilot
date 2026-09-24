import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { act, renderHook } from "@testing-library/react";
import type { App, TFile } from "obsidian";

jest.mock("@/settings/model", () => ({
  getSettings: () => ({ autoAddActiveContentToContext: false }),
}));

// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- minimal path-only stub for draft state tests
const file = (path: string): TFile => ({ path }) as unknown as TFile;
const queued = (id: string): QueuedAgentMessage => ({
  id,
  text: id,
  rawInput: id,
});

const app = { workspace: { getActiveFile: () => null } } as unknown as App;

interface Props {
  chatInputId: string;
  defaultIncludeActiveNote: boolean;
}

const renderDrafts = (initialProps: Props) => {
  const store = new AgentInputDraftStore(app, () => true);
  return {
    store,
    ...renderHook((props: Props) => useAgentInputDrafts({ store, ...props }), { initialProps }),
  };
};

describe("useAgentInputDrafts", () => {
  it("seeds a fresh draft from the defaults with frozen empties", () => {
    const { result } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: true,
    });

    expect(result.current.input).toBe("");
    expect(result.current.includeActiveNote).toBe(true);
    expect(result.current.includeActiveWebTab).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.images).toEqual([]);
    expect(result.current.contextNotes).toEqual([]);
    expect(result.current.queue).toEqual([]);
  });

  it("keeps each session's compose draft isolated across switches", () => {
    const { result, rerender } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("draft for a"));
    expect(result.current.input).toBe("draft for a");

    // Switch to b: its draft is fresh.
    rerender({
      chatInputId: "b",
      defaultIncludeActiveNote: false,
    });
    expect(result.current.input).toBe("");
    act(() => result.current.setInput("draft for b"));

    // Back to a: the unsent text survived the round-trip.
    rerender({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });
    expect(result.current.input).toBe("draft for a");
  });

  it("tracks loading per session so a background turn doesn't bleed", () => {
    const { result, rerender } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setLoading(true));
    expect(result.current.loading).toBe(true);

    rerender({
      chatInputId: "b",
      defaultIncludeActiveNote: false,
    });
    expect(result.current.loading).toBe(false);

    rerender({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });
    expect(result.current.loading).toBe(true);
  });

  it("applies functional updates to the input, attachments and queue", () => {
    const { result } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("typed"));
    act(() => result.current.setInput((prev) => `restored\n\n${prev}`));
    act(() => result.current.setContextNotes((prev) => [...prev, file("one.md")]));
    act(() => result.current.addImages([new File([], "img.png")]));
    act(() => result.current.setQueue((q) => [...q, queued("q1")]));

    expect(result.current.input).toBe("restored\n\ntyped");
    expect(result.current.contextNotes.map((n) => n.path)).toEqual(["one.md"]);
    expect(result.current.images).toHaveLength(1);
    expect(result.current.queue.map((q) => q.id)).toEqual(["q1"]);
  });

  it("resetCompose clears compose fields but leaves loading and queue", () => {
    const { result } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: true,
    });

    act(() => {
      result.current.setInput("hi");
      result.current.addImages([new File([], "img.png")]);
      result.current.setIncludeActiveWebTab(true);
      result.current.setLoading(true);
      result.current.setQueue(() => [queued("q1")]);
    });

    act(() => result.current.resetCompose());

    expect(result.current.input).toBe("");
    expect(result.current.images).toEqual([]);
    expect(result.current.includeActiveNote).toBe(false);
    expect(result.current.includeActiveWebTab).toBe(false);
    // Loading and the queue belong to the in-flight turn, not the compose box.
    expect(result.current.loading).toBe(true);
    expect(result.current.queue.map((q) => q.id)).toEqual(["q1"]);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 shows a note attached through the store while the composer is mounted", () => {
    const { result, store } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });
    const note = file("Research.md");

    act(() => store.addContextNote("a", note));

    expect(result.current.contextNotes).toEqual([note]);
  });

  it("attaches a note to its own chat input through addContextNote", () => {
    const { result, store } = renderDrafts({
      chatInputId: "a",
      defaultIncludeActiveNote: false,
    });
    const note = file("Research.md");

    act(() => result.current.addContextNote(note));

    expect(store.get("a")?.contextNotes).toEqual([note]);
  });
});
