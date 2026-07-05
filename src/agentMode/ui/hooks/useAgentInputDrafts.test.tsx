import {
  type QueuedAgentMessage,
  useAgentInputDrafts,
} from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { act, renderHook } from "@testing-library/react";
import type { TFile } from "obsidian";

// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- minimal path-only stub for draft state tests
const file = (path: string): TFile => ({ path }) as unknown as TFile;
const queued = (id: string): QueuedAgentMessage => ({
  id,
  text: id,
  rawInput: id,
});

interface Props {
  activeLaneId: string;
  liveLaneIds: string[];
  defaultIncludeActiveNote: boolean;
}

const renderDrafts = (initialProps: Props) =>
  renderHook((props: Props) => useAgentInputDrafts(props), { initialProps });

describe("useAgentInputDrafts", () => {
  it("seeds a fresh draft from the defaults with frozen empties", () => {
    const { result } = renderDrafts({
      activeLaneId: "a",
      liveLaneIds: ["a"],
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

  it("keeps each lane's compose draft isolated across switches", () => {
    const { result, rerender } = renderDrafts({
      activeLaneId: "a",
      liveLaneIds: ["a", "b"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("draft for a"));
    expect(result.current.input).toBe("draft for a");

    // Switch to lane b: its draft is fresh.
    rerender({ activeLaneId: "b", liveLaneIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("");
    act(() => result.current.setInput("draft for b"));

    // Back to a: the unsent text survived the round-trip.
    rerender({ activeLaneId: "a", liveLaneIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("draft for a");
  });

  it("tracks loading per lane so a background turn doesn't bleed", () => {
    const { result, rerender } = renderDrafts({
      activeLaneId: "a",
      liveLaneIds: ["a", "b"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setLoading(true));
    expect(result.current.loading).toBe(true);

    rerender({ activeLaneId: "b", liveLaneIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.loading).toBe(false);

    rerender({ activeLaneId: "a", liveLaneIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.loading).toBe(true);
  });

  it("applies functional updates to attachments and queue", () => {
    const { result } = renderDrafts({
      activeLaneId: "a",
      liveLaneIds: ["a"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setContextNotes((prev) => [...prev, file("one.md")]));
    act(() => result.current.addImages([new File([], "img.png")]));
    act(() => result.current.setQueue((q) => [...q, queued("q1")]));

    expect(result.current.contextNotes.map((n) => n.path)).toEqual(["one.md"]);
    expect(result.current.images).toHaveLength(1);
    expect(result.current.queue.map((q) => q.id)).toEqual(["q1"]);
  });

  it("resetCompose clears compose fields but leaves loading and queue", () => {
    const { result } = renderDrafts({
      activeLaneId: "a",
      liveLaneIds: ["a"],
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

  it("prunes a draft once its lane is no longer live", () => {
    const { result, rerender } = renderDrafts({
      activeLaneId: "a",
      liveLaneIds: ["a", "b"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("a text"));

    // Close lane a (its tab was closed with no replacement); only b remains live.
    rerender({ activeLaneId: "b", liveLaneIds: ["b"], defaultIncludeActiveNote: false });

    // Revisiting a (were it ever reselected) yields a fresh draft, not the old.
    rerender({ activeLaneId: "a", liveLaneIds: ["b"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("");
  });

  it("keeps a lane's draft across an in-place swap (old + new share the lane)", () => {
    // Simulates the empty-landing context refresh: the session is replaced in
    // place but INHERITS its compose lane, so the old and new session ids
    // momentarily both map to the same lane (a transient duplicate in
    // liveLaneIds). The draft is keyed by lane, so it survives natively — no
    // migration needed.
    const { result, rerender } = renderDrafts({
      activeLaneId: "lane",
      liveLaneIds: ["lane"],
      defaultIncludeActiveNote: false,
    });

    act(() => {
      result.current.setInput("typed during startup");
      result.current.setContextNotes([file("note.md")]);
      result.current.addImages([new File([], "img.png")]);
      result.current.setIncludeActiveWebTab(true);
      result.current.setQueue([queued("q1")]);
    });

    // The swap overlap: old + new session both report the same lane.
    rerender({
      activeLaneId: "lane",
      liveLaneIds: ["lane", "lane"],
      defaultIncludeActiveNote: false,
    });
    // Once the old session is pruned, only the single lane remains.
    rerender({ activeLaneId: "lane", liveLaneIds: ["lane"], defaultIncludeActiveNote: false });

    expect(result.current.input).toBe("typed during startup");
    expect(result.current.contextNotes.map((n) => n.path)).toEqual(["note.md"]);
    expect(result.current.images).toHaveLength(1);
    expect(result.current.includeActiveWebTab).toBe(true);
    expect(result.current.queue.map((q) => q.id)).toEqual(["q1"]);
  });
});
