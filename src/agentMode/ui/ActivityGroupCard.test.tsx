import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import type { ActivityGroupNode, ActivityMember } from "@/agentMode/ui/activityGroups";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function action(id: string, overrides: Partial<ToolCallPart> = {}): ActivityMember {
  return {
    type: "action",
    part: { kind: "tool_call", id, title: id, status: "completed", ...overrides },
  };
}

const REASONING: ActivityMember = { type: "reasoning", part: { kind: "thought", text: "…" } };

function group(members: ActivityMember[]): ActivityGroupNode {
  return { type: "activityGroup", id: "activity-0", members };
}

/** Stand-in for the trail's real dispatch, so the card's own behavior is what's asserted. */
function renderMember(member: ActivityMember, key: string | number): React.ReactNode {
  return <div key={key}>{member.type === "action" ? member.part.title : "reasoning"}</div>;
}

function renderCard(props: Partial<React.ComponentProps<typeof ActivityGroupCard>> = {}) {
  return render(
    <ActivityGroupCard
      group={group([action("a", { vendorToolName: "Read" })])}
      open={false}
      onToggle={jest.fn()}
      renderMember={renderMember}
      {...props}
    />
  );
}

describe("ActivityGroupCard", () => {
  describe("ActivityGroupCard()", () => {
    it("summarizes every family in the run plus the measured thinking time", () => {
      renderCard({
        group: group([
          action("a", { vendorToolName: "Read" }),
          REASONING,
          action("b", { vendorToolName: "Bash" }),
          action("c", { vendorToolName: "Bash" }),
        ]),
        thinkingMs: 51_000,
      });

      expect(screen.getByRole("button").textContent).toContain(
        "Read 1 file, ran 2 commands, thought for 51s"
      );
    });

    it("surfaces how many members failed", () => {
      const { rerender } = renderCard({
        group: group([
          action("a", { vendorToolName: "Bash", status: "failed" }),
          action("b", { vendorToolName: "Bash", status: "failed" }),
          action("c", { vendorToolName: "Bash" }),
        ]),
      });

      expect(screen.getByText("2 failed")).not.toBeNull();

      rerender(
        <ActivityGroupCard
          group={group([action("a", { vendorToolName: "Bash" })])}
          open={false}
          onToggle={jest.fn()}
          renderMember={renderMember}
        />
      );
      expect(screen.queryByText(/failed/)).toBeNull();
    });

    it("spins only while a member tool call is still running", () => {
      const { container, rerender } = renderCard({
        group: group([action("a", { vendorToolName: "Read" }), action("b", { status: "failed" })]),
      });

      expect(container.querySelector(".tw-animate-spin")).toBeNull();

      rerender(
        <ActivityGroupCard
          group={group([
            action("a", { vendorToolName: "Read" }),
            action("b", { vendorToolName: "Bash", status: "in_progress" }),
          ])}
          open={false}
          onToggle={jest.fn()}
          renderMember={renderMember}
        />
      );
      expect(container.querySelector(".tw-animate-spin")).not.toBeNull();
    });

    it("asks its owner to toggle instead of opening itself", () => {
      const onToggle = jest.fn();
      renderCard({ group: group([action("a"), action("b")]), onToggle });

      const header = screen.getByRole("button");
      expect(header.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(header);
      expect(onToggle).toHaveBeenCalledTimes(1);
      // Controlled: the card stays closed until the owner says otherwise.
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    });

    it("renders members only once open, in the region the header controls", () => {
      const members = [action("Read notes/Inbox.md"), REASONING];
      const { container, rerender } = renderCard({ group: group(members) });

      expect(screen.queryByText("Read notes/Inbox.md")).toBeNull();

      rerender(
        <ActivityGroupCard
          group={group(members)}
          open
          onToggle={jest.fn()}
          renderMember={renderMember}
        />
      );

      const header = screen.getByRole("button");
      expect(header.getAttribute("aria-expanded")).toBe("true");
      const body = container.querySelector(`[id="${header.getAttribute("aria-controls")}"]`);
      expect(body?.textContent).toBe("Read notes/Inbox.mdreasoning");
    });

    it("shows the live step only while collapsed", () => {
      const members = [action("a"), action("b")];
      const { rerender } = renderCard({
        group: group(members),
        liveStep: <span>Running npm test</span>,
      });

      expect(screen.getByText("Running npm test")).not.toBeNull();

      rerender(
        <ActivityGroupCard
          group={group(members)}
          open
          onToggle={jest.fn()}
          renderMember={renderMember}
          liveStep={<span>Running npm test</span>}
        />
      );
      expect(screen.queryByText("Running npm test")).toBeNull();
    });
  });
});
