import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { act, renderHook } from "@testing-library/react";
import type { App, TFile } from "obsidian";

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
}

const renderDrafts = (initialProps: Props) => {
  const store = new AgentInputDraftStore(app, () => true);
  return {
    store,
    ...renderHook((props: Props) => useAgentInputDrafts({ store, ...props }), { initialProps }),
  };
};

describe("useAgentInputDrafts", () => {
  it("seeds a fresh draft that includes the active note and web tab, with frozen empties", () => {
    const { result } = renderDrafts({ chatInputId: "a" });

    expect(result.current.input).toBe("");
    expect(result.current.includeActiveNote).toBe(true);
    expect(result.current.includeActiveWebTab).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.images).toEqual([]);
    expect(result.current.contextNotes).toEqual([]);
    expect(result.current.queue).toEqual([]);
  });

  it("keeps each session's compose draft isolated across switches", () => {
    const { result, rerender } = renderDrafts({ chatInputId: "a" });

    act(() => result.current.setInput("draft for a"));
    expect(result.current.input).toBe("draft for a");

    rerender({ chatInputId: "b" });
    expect(result.current.input).toBe("");
    act(() => result.current.setInput("draft for b"));

    rerender({ chatInputId: "a" });
    expect(result.current.input).toBe("draft for a");
  });

  it("tracks loading per session so a background turn doesn't bleed", () => {
    const { result, rerender } = renderDrafts({ chatInputId: "a" });

    act(() => result.current.setLoading(true));
    expect(result.current.loading).toBe(true);

    rerender({ chatInputId: "b" });
    expect(result.current.loading).toBe(false);

    rerender({ chatInputId: "a" });
    expect(result.current.loading).toBe(true);
  });

  it("applies functional updates to the input, attachments and queue", () => {
    const { result } = renderDrafts({ chatInputId: "a" });

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

  it("resetCompose clears compose fields and the active note but leaves loading and queue", () => {
    const { result } = renderDrafts({ chatInputId: "a" });

    act(() => {
      result.current.setInput("hi");
      result.current.addImages([new File([], "img.png")]);
      result.current.setLoading(true);
      result.current.setQueue(() => [queued("q1")]);
    });

    act(() => result.current.resetCompose());

    expect(result.current.input).toBe("");
    expect(result.current.images).toEqual([]);
    expect(result.current.includeActiveNote).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.queue.map((q) => q.id)).toEqual(["q1"]);
  });

  it.each([
    ["keeps a removed active web tab off", false],
    ["keeps an included active web tab on", true],
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/667 resetCompose %s for the session's later messages",
    (_case, included) => {
      const { result } = renderDrafts({ chatInputId: "a" });

      act(() => result.current.setIncludeActiveWebTab(included));
      act(() => result.current.resetCompose());

      expect(result.current.includeActiveWebTab).toBe(included);
    }
  );

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 shows a note attached through the store while the composer is mounted", () => {
    const { result, store } = renderDrafts({ chatInputId: "a" });
    const note = file("Research.md");

    act(() => store.addContextNote("a", note));

    expect(result.current.contextNotes).toEqual([note]);
  });
});
