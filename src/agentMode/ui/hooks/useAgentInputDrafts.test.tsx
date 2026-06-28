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
  activeSessionId: string;
  liveSessionIds: string[];
  defaultIncludeActiveNote: boolean;
}

const renderDrafts = (initialProps: Props) =>
  renderHook((props: Props) => useAgentInputDrafts(props), { initialProps });

describe("useAgentInputDrafts", () => {
  it("seeds a fresh draft from the defaults with frozen empties", () => {
    const { result } = renderDrafts({
      activeSessionId: "a",
      liveSessionIds: ["a"],
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
      activeSessionId: "a",
      liveSessionIds: ["a", "b"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("draft for a"));
    expect(result.current.input).toBe("draft for a");

    // Switch to b: its draft is fresh.
    rerender({ activeSessionId: "b", liveSessionIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("");
    act(() => result.current.setInput("draft for b"));

    // Back to a: the unsent text survived the round-trip.
    rerender({ activeSessionId: "a", liveSessionIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("draft for a");
  });

  it("tracks loading per session so a background turn doesn't bleed", () => {
    const { result, rerender } = renderDrafts({
      activeSessionId: "a",
      liveSessionIds: ["a", "b"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setLoading(true));
    expect(result.current.loading).toBe(true);

    rerender({ activeSessionId: "b", liveSessionIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.loading).toBe(false);

    rerender({ activeSessionId: "a", liveSessionIds: ["a", "b"], defaultIncludeActiveNote: false });
    expect(result.current.loading).toBe(true);
  });

  it("applies functional updates to attachments and queue", () => {
    const { result } = renderDrafts({
      activeSessionId: "a",
      liveSessionIds: ["a"],
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
      activeSessionId: "a",
      liveSessionIds: ["a"],
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

  it("prunes a draft once its session is no longer live", () => {
    const { result, rerender } = renderDrafts({
      activeSessionId: "a",
      liveSessionIds: ["a", "b"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("a text"));

    // Close session a (e.g. tab closed / replaced); only b remains live.
    rerender({ activeSessionId: "b", liveSessionIds: ["b"], defaultIncludeActiveNote: false });

    // Revisiting a (were it ever reselected) yields a fresh draft, not the old.
    rerender({ activeSessionId: "a", liveSessionIds: ["b"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("");
  });

  it("migrates a draft typed during a session swap onto the replacement id", () => {
    // Simulates the empty-landing refresh: the user types while the old session
    // is still active (the new id isn't in liveSessionIds yet), then the swap
    // migrates that draft onto the new session before the old one is pruned.
    const { result, rerender } = renderDrafts({
      activeSessionId: "old",
      liveSessionIds: ["old"],
      defaultIncludeActiveNote: false,
    });

    act(() => {
      result.current.setInput("typed during startup");
      result.current.setContextNotes([file("note.md")]);
      result.current.addImages([new File([], "img.png")]);
      result.current.setIncludeActiveWebTab(true);
      result.current.setQueue([queued("q1")]);
    });

    act(() => result.current.migrateDraft("old", "new"));

    // Once React observes the new session, its draft carries the typed content.
    rerender({ activeSessionId: "new", liveSessionIds: ["new"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("typed during startup");
    expect(result.current.contextNotes.map((n) => n.path)).toEqual(["note.md"]);
    expect(result.current.images).toHaveLength(1);
    expect(result.current.includeActiveWebTab).toBe(true);
    expect(result.current.queue.map((q) => q.id)).toEqual(["q1"]);

    // The old id no longer holds the migrated draft.
    rerender({ activeSessionId: "old", liveSessionIds: ["new"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("");
  });

  it("does not migrate an empty source draft (clean swap stays clean)", () => {
    const { result, rerender } = renderDrafts({
      activeSessionId: "old",
      liveSessionIds: ["old"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.migrateDraft("old", "new"));

    rerender({ activeSessionId: "new", liveSessionIds: ["new"], defaultIncludeActiveNote: false });
    expect(result.current.input).toBe("");
  });

  it("does not clobber input the user already started on the replacement", () => {
    const { result, rerender } = renderDrafts({
      activeSessionId: "old",
      liveSessionIds: ["old", "new"],
      defaultIncludeActiveNote: false,
    });

    act(() => result.current.setInput("old draft"));
    rerender({
      activeSessionId: "new",
      liveSessionIds: ["old", "new"],
      defaultIncludeActiveNote: false,
    });
    act(() => result.current.setInput("new draft"));

    act(() => result.current.migrateDraft("old", "new"));
    expect(result.current.input).toBe("new draft");
  });
});
