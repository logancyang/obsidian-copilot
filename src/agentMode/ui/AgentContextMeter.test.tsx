import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

// Radix Popover portals into Obsidian's `activeDocument`; jsdom lacks it.
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

describe("AgentContextMeter", () => {
  it("renders the % ring plus popover numbers when contextWindow is known", () => {
    const usage: SessionUsage = {
      usedTokens: 50_000,
      contextWindow: 200_000,
      inputTokens: 40_000,
      outputTokens: 8_000,
      cacheReadTokens: 1_500,
      cacheWriteTokens: 500,
      costUsd: 0.42,
      updatedAt: 1,
    };
    render(<AgentContextMeter backend={makeBackend(usage)} />);

    const trigger = screen.getByLabelText("Context usage");
    // 50k / 200k = 25%.
    expect(trigger.textContent).toContain("25%");

    fireEvent.click(trigger);

    // used / total headline numbers.
    expect(screen.getByText("50,000 / 200,000")).toBeTruthy();
    // input · output · cache(read+write) breakdown.
    expect(screen.getByText("40k in · 8k out · 2k cache")).toBeTruthy();
    // Estimated session cost, USD-formatted (ring branch only).
    expect(screen.getByText("$0.42")).toBeTruthy();
  });

  it("applies the warning color once usage reaches 85%", () => {
    const usage: SessionUsage = {
      usedTokens: 170_000,
      contextWindow: 200_000,
      updatedAt: 1,
    };
    render(<AgentContextMeter backend={makeBackend(usage)} />);

    const trigger = screen.getByLabelText("Context usage");
    expect(trigger.textContent).toContain("85%");
    expect(trigger.className).toContain("tw-text-warning");
    expect(trigger.className).not.toContain("tw-text-accent");
  });

  it("stays on the accent color below the warning threshold", () => {
    const usage: SessionUsage = {
      usedTokens: 100_000,
      contextWindow: 200_000,
      updatedAt: 1,
    };
    render(<AgentContextMeter backend={makeBackend(usage)} />);

    const trigger = screen.getByLabelText("Context usage");
    expect(trigger.className).toContain("tw-text-accent");
    expect(trigger.className).not.toContain("tw-text-warning");
  });

  it("falls back to the count-only TokenCounter (no cost) when there is no contextWindow", () => {
    const usage: SessionUsage = {
      usedTokens: 12_000,
      inputTokens: 10_000,
      costUsd: 1.23,
      updatedAt: 1,
    };
    // TokenCounter renders a Radix Tooltip, which the app mounts under a
    // TooltipProvider at the root; provide one here.
    const { container } = render(
      <TooltipProvider>
        <AgentContextMeter backend={makeBackend(usage)} />
      </TooltipProvider>
    );

    // No ring meter — the fallback chip has no "Context usage" trigger.
    expect(screen.queryByLabelText("Context usage")).toBeNull();
    // TokenCounter shows the rounded-thousands chip.
    expect(container.textContent).toContain("12k");
    // Fallback must NOT surface a cost, even though costUsd is present.
    expect(container.textContent).not.toContain("$1.23");
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
