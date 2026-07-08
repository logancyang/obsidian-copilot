import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

// Radix Tooltip portals into Obsidian's `activeDocument`; jsdom lacks it.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

/** Minimal backend stub exposing just the getters/subscribe the meter reads. */
function makeBackend(usage: SessionUsage | null): AgentChatBackend {
  return {
    getSessionUsage: () => usage,
    subscribe: () => () => {},
  } as unknown as AgentChatBackend;
}

/** The meter's tooltip needs a Radix `TooltipProvider` ancestor (the app mounts
 * one at the chat-view root, alongside the sibling control buttons). */
function renderMeter(backend: AgentChatBackend) {
  return render(
    <TooltipProvider>
      <AgentContextMeter backend={backend} />
    </TooltipProvider>
  );
}

describe("AgentContextMeter", () => {
  it("renders the % ring plus tooltip numbers when contextWindow is known", () => {
    const usage: SessionUsage = {
      usedTokens: 50_000,
      contextWindow: 200_000,
      inputTokens: 40_000,
      outputTokens: 8_000,
      cacheReadTokens: 1_500,
      cacheWriteTokens: 500,
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage));

    // The trigger is an icon-sized button with just the ring (no inline % text).
    const trigger = screen.getByLabelText("Context usage");
    expect(trigger.textContent).not.toContain("25%");

    // The tooltip opens on hover/focus, not click.
    fireEvent.focus(trigger);

    // Tooltip: "Context window" label + used / total (percent) on one line.
    // Radix Tooltip renders the content twice (visible + a visually-hidden a11y
    // copy), so assert on all matches rather than a single node.
    expect(screen.getAllByText("Context window").length).toBeGreaterThan(0);
    // 50k / 200k = 25%, formatted with k/M suffixes.
    expect(screen.getAllByText("50.0k / 200.0k (25%)").length).toBeGreaterThan(0);
    // The technical breakdown was intentionally dropped.
    expect(screen.queryByText(/in ·|out ·| cache/)).toBeNull();
  });

  it("applies the warning color once usage reaches 85%", () => {
    const usage: SessionUsage = {
      usedTokens: 170_000,
      contextWindow: 200_000,
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage));

    const trigger = screen.getByLabelText("Context usage");
    // The warning accent lives on the trigger itself.
    expect(trigger.className).toContain("tw-text-warning");
    expect(trigger.className).not.toContain("tw-text-accent");

    // 170k / 200k = 85%, surfaced in the tooltip stats line (opens on focus).
    fireEvent.focus(trigger);
    expect(screen.getAllByText("170.0k / 200.0k (85%)").length).toBeGreaterThan(0);
  });

  it("stays on the accent color below the warning threshold", () => {
    const usage: SessionUsage = {
      usedTokens: 100_000,
      contextWindow: 200_000,
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage));

    const trigger = screen.getByLabelText("Context usage");
    expect(trigger.className).toContain("tw-text-accent");
    expect(trigger.className).not.toContain("tw-text-warning");
  });

  it("falls back to the count-only TokenCounter when there is no contextWindow", () => {
    const usage: SessionUsage = {
      usedTokens: 12_000,
      inputTokens: 10_000,
      updatedAt: 1,
    };
    // TokenCounter also renders a Radix Tooltip, so it needs the provider too.
    const { container } = renderMeter(makeBackend(usage));

    // No ring meter — the fallback chip has no "Context usage" trigger.
    expect(screen.queryByLabelText("Context usage")).toBeNull();
    // TokenCounter shows the rounded-thousands chip.
    expect(container.textContent).toContain("12k");
  });

  it("renders nothing (no separator) when usage is null", () => {
    const { container } = render(<AgentContextMeter backend={makeBackend(null)} />);
    expect(container.childElementCount).toBe(0);
  });

  it("renders nothing (no separator, no chip) when usedTokens is 0 and there is no contextWindow", () => {
    const usage: SessionUsage = { usedTokens: 0, updatedAt: 1 };
    const { container } = render(<AgentContextMeter backend={makeBackend(usage)} />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByLabelText("Context usage")).toBeNull();
  });
});
