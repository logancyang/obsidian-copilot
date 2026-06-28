import AgentContextStatusIcon, { buildStatusView } from "@/agentMode/ui/AgentContextStatusIcon";
import {
  agentProjectContextLoadAtom,
  type AgentProjectContextLoadState,
  type FailedItem,
  type ProjectConfig,
} from "@/aiParams";
import { settingsStore } from "@/settings/model";
import { act, render } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";

// Radix Popover portals resolve Obsidian's `activeDocument` global at render;
// jsdom doesn't define it. Point it at the test document.
(window as unknown as { activeDocument: Document }).activeDocument = window.document;

function entry(over: Partial<AgentProjectContextLoadState> = {}): AgentProjectContextLoadState {
  return { phase: "done", blocking: false, ...over };
}

const webFailure: FailedItem = {
  path: "https://a.com",
  type: "web",
  error: "boom",
  usedStaleSnapshot: false,
};
const staleFailure: FailedItem = {
  path: "https://b.com",
  type: "web",
  error: "network down",
  usedStaleSnapshot: true,
};

describe("buildStatusView", () => {
  it("rests on idle when there is no entry", () => {
    const v = buildStatusView(undefined, true);
    expect(v.kind).toBe("idle");
    expect(v.headline).toBe("No context loaded");
  });

  it("rests on idle on the idle phase", () => {
    expect(buildStatusView(entry({ phase: "idle" }), true).kind).toBe("idle");
  });

  it("rests on idle for a clean completion when the project has no configured context source", () => {
    expect(buildStatusView(entry({ phase: "done" }), false).kind).toBe("idle");
  });

  it("is ready on a clean completion with a configured context source", () => {
    const v = buildStatusView(entry({ phase: "done" }), true);
    expect(v.kind).toBe("ready");
    expect(v.headline).toBe("Context ready");
  });

  it("is working during a materialization phase", () => {
    const v = buildStatusView(
      entry({ phase: "prefetch", blocking: true, prefetch: { done: 2, total: 4 } }),
      true
    );
    expect(v.kind).toBe("working");
    expect(v.headline).toBe("Indexing context · 2/4");
  });

  it("is working when a retry is in flight even though the phase is still done", () => {
    // A per-row retry sets `retryingSources` but leaves phase at "done" (and
    // optimistically clears the failure) — the glyph must read working, not the
    // green "ready" the bare phase check would give.
    const v = buildStatusView(
      entry({ phase: "done", retryingSources: [{ kind: "web", source: "https://a.com" }] }),
      true
    );
    expect(v.kind).toBe("working");
  });

  it("is working when a source is processing even though the phase is still done", () => {
    const v = buildStatusView(
      entry({ phase: "done", processingSources: [{ kind: "web", source: "https://a.com" }] }),
      true
    );
    expect(v.kind).toBe("working");
  });

  it("is failed from a persistent on-disk marker count when no entry exists yet", () => {
    // A project whose failures live only as disk markers (Option D), with no run
    // this session — the icon must read failed, not idle/ready.
    const v = buildStatusView(undefined, true, 1);
    expect(v.kind).toBe("failed");
    expect(v.headline).toBe("1 source failed");
  });

  it("is failed from the persistent count on a clean-looking settled entry", () => {
    const v = buildStatusView(entry({ phase: "done" }), true, 2);
    expect(v.kind).toBe("failed");
    expect(v.headline).toBe("2 sources failed");
  });

  it("prefers live missing failures over the persistent count", () => {
    // A live missing failure is this run's truth; the disk count must not inflate
    // the headline.
    const v = buildStatusView(entry({ phase: "done", failedSources: [webFailure] }), true, 5);
    expect(v.kind).toBe("failed");
    expect(v.headline).toBe("1 source failed");
  });

  it("stays working over a persistent count while a retry is in flight", () => {
    const v = buildStatusView(
      entry({ phase: "done", retryingSources: [{ kind: "web", source: "https://a.com" }] }),
      true,
      3
    );
    expect(v.kind).toBe("working");
  });

  it("is failed when a source is missing (no stale fallback)", () => {
    const v = buildStatusView(entry({ phase: "done", failedSources: [webFailure] }), true);
    expect(v.kind).toBe("failed");
    expect(v.headline).toBe("1 source failed");
  });

  it("stays ready (green) when failures are stale-but-usable only", () => {
    const v = buildStatusView(entry({ phase: "done", failedSources: [staleFailure] }), true);
    expect(v.kind).toBe("ready");
    // The stale failure is still surfaced in the popover list.
    expect(v.failures).toHaveLength(1);
  });

  it("counts only missing sources in the failed headline", () => {
    const v = buildStatusView(
      entry({ phase: "done", failedSources: [webFailure, staleFailure] }),
      true
    );
    expect(v.kind).toBe("failed");
    expect(v.headline).toBe("1 source failed");
    expect(v.failures).toHaveLength(2); // both shown in detail
  });

  it("shows real-count step rows when present", () => {
    const v = buildStatusView(
      entry({ phase: "done", resolved: 243, prefetch: { done: 4, total: 4 } }),
      true
    );
    const labels = v.steps.map((s) => s.label);
    expect(labels).toContain("Resolve files (243)");
    expect(labels).toContain("Prefetch 4 URLs · 4/4");
    // No fabricated "Apply 100-cap" row — only real-count steps are shown.
    expect(labels).not.toContain("Apply 100-cap");
    expect(v.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("treats a synthetic whole-context failure as failed", () => {
    const v = buildStatusView(
      entry({ phase: "done", failedSources: [{ path: "Project context", type: "nonMd", error: "fs" }] }), // prettier-ignore
      true
    );
    expect(v.kind).toBe("failed");
  });
});

describe("AgentContextStatusIcon anti-flash", () => {
  const PROJECT = "proj-1";
  const noop = () => {};

  function setEntry(e: AgentProjectContextLoadState | undefined) {
    settingsStore.set(agentProjectContextLoadAtom, e ? { [PROJECT]: e } : {});
  }

  // app/project only matter once the popover opens (the conversion body mounts);
  // these anti-flash tests assert the trigger glyph only, so minimal stubs suffice.
  const APP = {} as unknown as App;
  const PROJECT_CONFIG = { id: PROJECT } as unknown as ProjectConfig;

  function renderIcon() {
    return render(
      <AgentContextStatusIcon
        app={APP}
        activeProjectId={PROJECT}
        project={PROJECT_CONFIG}
        hasConfiguredContextSource
        landing={false}
        onReindex={() => false}
        onRetryItem={() => Promise.resolve(false)}
        onRefreshLanding={noop}
        onEditContext={noop}
      />
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    setEntry(undefined);
  });
  afterEach(() => {
    // Real timers restored after RTL's auto-unmount (registered at import, so it
    // runs after this inner hook) — the atom reset lives in beforeEach to avoid
    // writing the store while a component from this test is still mounted.
    jest.useRealTimers();
  });

  // The trigger button is always present now (the icon rests on the gray idle
  // glyph), so anti-flash is asserted on the spinner glyph (`tw-animate-spin`),
  // not on the button's presence.
  const spinner = (c: HTMLElement) => c.querySelector(".tw-animate-spin");

  it("shows the gray idle trigger with no entry (never hidden)", () => {
    setEntry(undefined);
    const { container } = renderIcon();
    expect(container.querySelector('[aria-label="Project context status"]')).not.toBeNull();
    expect(spinner(container)).toBeNull();
  });

  it("does not flash the working spinner if the run settles within 300ms (warm cache)", () => {
    setEntry({ phase: "resolve", blocking: true });
    const { container } = renderIcon();
    // Within the reveal delay the trigger stays on the idle glyph — no spinner.
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(spinner(container)).toBeNull();
    // The run completes cleanly before the timer elapses → straight to ready.
    act(() => {
      setEntry({ phase: "done", blocking: false, failedSources: [] });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(spinner(container)).toBeNull();
  });

  it("shows the working spinner once the run exceeds 300ms (cold)", () => {
    setEntry({ phase: "prefetch", blocking: true, prefetch: { done: 0, total: 4 } });
    const { container } = renderIcon();
    // Masked as idle until the reveal delay elapses.
    expect(spinner(container)).toBeNull();
    act(() => {
      jest.advanceTimersByTime(350);
    });
    expect(spinner(container)).not.toBeNull();
  });

  it("shows the working spinner immediately for a user retry (no anti-flash idle blink)", () => {
    // A per-row retry keeps phase `done` and sets `retryingSources`; the user just
    // clicked, so the spinner must show at once — never blink the neutral idle
    // glyph first.
    setEntry({
      phase: "done",
      blocking: false,
      retryingSources: [{ kind: "web", source: "https://a.com" }],
    });
    const { container } = renderIcon();
    expect(spinner(container)).not.toBeNull();
  });
});
