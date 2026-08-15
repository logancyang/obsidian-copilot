import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { PlanUsage, SessionUsage } from "@/agentMode/session/types";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

// Radix Tooltip portals into Obsidian's `activeDocument`; jsdom lacks it.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

/** Minimal backend stub exposing just the getters/subscribe the meter reads. */
function makeBackend(
  usage: SessionUsage | null,
  planUsage: PlanUsage | null = null
): AgentChatBackend {
  return {
    getSessionUsage: () => usage,
    getPlanUsage: () => planUsage,
    getBackendState: () => null,
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
    const trigger = screen.getByLabelText("Usage");
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

    const trigger = screen.getByLabelText("Usage");
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

    const trigger = screen.getByLabelText("Usage");
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

  it("shows each plan cap window, its percentage and its reset, under the context bar", () => {
    const usage: SessionUsage = { usedTokens: 50_000, contextWindow: 200_000, updatedAt: 1 };
    const planUsage: PlanUsage = {
      windows: [
        { id: "five_hour", label: "5h", percent: 10, resetsAt: Date.now() + 2 * 3_600_000 },
        { id: "seven_day", label: "Weekly", percent: 21, resetsAt: Date.now() + 3 * 86_400_000 },
      ],
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage, planUsage));

    fireEvent.focus(screen.getByLabelText("Usage"));

    expect(screen.getAllByText("10%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("21%").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/resets in 2h/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/resets in 3d/).length).toBeGreaterThan(0);
  });

  it("drops a cap window whose reset has passed by render time (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", () => {
    // A chat left open across a reset gets no new event to correct its snapshot, so the
    // finished period's percentage must be filtered where it is rendered.
    const usage: SessionUsage = { usedTokens: 50_000, contextWindow: 200_000, updatedAt: 1 };
    const planUsage: PlanUsage = {
      windows: [
        { id: "five_hour", label: "5h", percent: 95, resetsAt: Date.now() - 1 },
        { id: "seven_day", label: "Weekly", percent: 21, resetsAt: Date.now() + 3 * 86_400_000 },
      ],
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage, planUsage));

    fireEvent.focus(screen.getByLabelText("Usage"));

    expect(screen.queryByText("95%")).toBeNull();
    expect(screen.getAllByText("21%").length).toBeGreaterThan(0);
  });

  it("shows the real figure when an account is past its cap", () => {
    const usage: SessionUsage = { usedTokens: 1_000, contextWindow: 200_000, updatedAt: 1 };
    const planUsage: PlanUsage = {
      windows: [{ id: "seven_day", label: "Weekly", percent: 137 }],
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage, planUsage));

    fireEvent.focus(screen.getByLabelText("Usage"));

    // Not clamped to 100: "just hit the cap" and "far past it" must not look alike.
    expect(screen.getAllByText("137%").length).toBeGreaterThan(0);
  });

  it("renders no cap rows when the backend reports no plan usage", () => {
    const usage: SessionUsage = { usedTokens: 50_000, contextWindow: 200_000, updatedAt: 1 };
    renderMeter(makeBackend(usage, null));

    fireEvent.focus(screen.getByLabelText("Usage"));

    // A backend with no usage API, or an account not metered by plan caps, shows
    // nothing rather than a fabricated 0%.
    expect(screen.queryAllByText(/resets in/)).toHaveLength(0);
    expect(screen.queryAllByText("0%")).toHaveLength(0);
  });

  it("shows plan caps even when the backend reports no context window", () => {
    // Copilot Plus models arrive without a window. The meter used to fall straight
    // through to the count-only chip here, computing the caps and then dropping them,
    // so a user on those models saw a bare token count and no caps at all.
    const usage: SessionUsage = { usedTokens: 27_514, updatedAt: 1 };
    const planUsage: PlanUsage = {
      windows: [
        { id: "five_hour", label: "5h", percent: 8, resetsAt: Date.now() + 3_600_000 },
        { id: "weekly", label: "Weekly", percent: 25, resetsAt: Date.now() + 86_400_000 },
      ],
      updatedAt: 1,
    };
    renderMeter(makeBackend(usage, planUsage));

    fireEvent.focus(screen.getByLabelText("Usage"));

    expect(screen.getAllByText("8%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("25%").length).toBeGreaterThan(0);
    // The context row still reports the count it does know, without a bogus percentage.
    expect(screen.getAllByText("27.5k").length).toBeGreaterThan(0);
  });
});
