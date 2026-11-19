import type { AgentMention } from "@/agents/agentMentions";
import {
  AgentMentionStatus,
  AgentMentionStatusLines,
} from "@/agents/agentMode/ui/AgentMentionStatus";
import { setCustomAgentsLaunched } from "@/agents/testing/customAgentsLaunched";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { resetSettings } from "@/settings/model";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const NOW = Date.parse("2026-11-16T10:05:12Z");

function run(change: Partial<AgentMention> = {}): AgentMention {
  return {
    id: "m1",
    agent: "leo",
    name: "Leo",
    status: "working",
    startedAt: NOW - 3 * 60_000 - 10_000,
    ...change,
  };
}

describe("AgentMentionStatus", () => {
  beforeEach(() => resetSettings());

  describe("AgentMentionStatus()", () => {
    afterEach(() => jest.useRealTimers());

    it(`counts up each second while the agent works (${ISSUE})`, () => {
      jest.useFakeTimers({ now: NOW });
      const { container } = render(<AgentMentionStatus mention={run()} />);
      expect(container.textContent).toBe("Leo is working3:10");

      act(() => jest.advanceTimersByTime(2_000));

      expect(container.textContent).toBe("Leo is working3:12");
    });

    it(`holds the clock while the agent waits on the user and counts on once it works again (${ISSUE})`, () => {
      jest.useFakeTimers({ now: NOW });
      const { container, rerender } = render(<AgentMentionStatus mention={run()} />);
      act(() => jest.advanceTimersByTime(2_000));

      rerender(<AgentMentionStatus mention={run({ status: "question" })} />);
      act(() => jest.advanceTimersByTime(60_000));

      expect(container.textContent).toBe("Leo has a question3:12");

      rerender(<AgentMentionStatus mention={run()} />);

      expect(container.textContent).toBe("Leo is working4:12");

      act(() => jest.advanceTimersByTime(1_000));

      expect(container.textContent).toBe("Leo is working4:13");
    });

    it(`scrolls to the relayed reply from See reply (${ISSUE})`, () => {
      const relay = document.body.createDiv({ attr: { "data-agent-relay": "m1" } });
      relay.scrollIntoView = jest.fn();
      render(<AgentMentionStatus mention={run({ status: "finished", endedAt: NOW })} />);

      fireEvent.click(screen.getByText("See reply ↓"));

      expect(relay.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
      relay.remove();
    });

    it("shows the error behind Something went wrong when Details is chosen", () => {
      render(
        <AgentMentionStatus
          mention={run({
            status: "didnt_finish",
            endedAt: NOW,
            end: { kind: "error", message: "Leo's chat stopped before it finished." },
          })}
        />
      );
      expect(screen.queryByText("Leo's chat stopped before it finished.")).toBeNull();

      fireEvent.click(screen.getByText("Details"));

      expect(screen.getByText("Leo's chat stopped before it finished.")).toBeTruthy();
    });
  });

  describe("AgentMentionStatusLines()", () => {
    it(`draws one line per asked agent, in the order they were asked (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { container } = render(
        <AgentMentionStatusLines
          mentions={[
            run({ id: "m1", name: "Maya", status: "finished", endedAt: NOW }),
            run({
              id: "m2",
              name: "Leo",
              status: "didnt_finish",
              end: { kind: "obsidian_closed" },
            }),
          ]}
        />
      );

      expect(Array.from(container.firstElementChild!.children, (line) => line.textContent)).toEqual(
        ["Maya finished3:10See reply ↓", "Leo didn't finish · Obsidian was closed"]
      );
    });

    it(`draws nothing without a license that includes custom agents (${ISSUE})`, async () => {
      await setCustomAgentsAccess("free");

      const { container } = render(<AgentMentionStatusLines mentions={[run()]} />);

      expect(container.innerHTML).toBe("");
    });

    it("still draws the lines after the license lapsed, from the saved runs (https://github.com/Brevilabs/obsidian-copilot-private/issues/950)", async () => {
      await setCustomAgentsAccess("free");
      setCustomAgentsLaunched(true);
      const { container } = render(<AgentMentionStatusLines mentions={[run()]} />);

      expect(container.textContent).toContain("Leo is working");
    });

    it("draws nothing for a message that asked no agent", async () => {
      await setCustomAgentsAccess("team");

      const { container } = render(<AgentMentionStatusLines />);

      expect(container.innerHTML).toBe("");
    });
  });
});
