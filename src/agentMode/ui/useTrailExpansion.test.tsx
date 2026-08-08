import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import type { ActivityMember } from "@/agentMode/ui/activityGroups";
import { useTrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";

function action(id: string): ActivityMember {
  return {
    type: "action",
    part: { kind: "tool_call", id, title: id, status: "completed", vendorToolName: "Read" },
  };
}

/**
 * Stands in for the trail: state above the node list, groups addressed by their
 * trail-ordinal id. Growing `members` is what a streaming turn does.
 */
const Trail: React.FC<{ members: ActivityMember[] }> = ({ members }) => {
  const { isOpen, toggle } = useTrailExpansion();
  return (
    <ActivityGroupCard
      group={{ type: "activityGroup", id: "activity-0", members }}
      open={isOpen("activity-0")}
      onToggle={() => toggle("activity-0")}
      renderMember={(m, key) => <div key={key}>{m.type === "action" ? m.part.id : "thought"}</div>}
    />
  );
};

describe("useTrailExpansion", () => {
  describe("useTrailExpansion()", () => {
    it("reports every group closed until the user opens one", () => {
      const { result, rerender } = renderHook(() => useTrailExpansion());

      expect(result.current.isOpen("activity-0")).toBe(false);
      rerender();
      expect(result.current.isOpen("activity-0")).toBe(false);

      act(() => result.current.toggle("activity-0"));

      expect(result.current.isOpen("activity-0")).toBe(true);
      expect(result.current.isOpen("activity-1")).toBe(false);
    });

    it("closes a group again only when the user toggles it a second time", () => {
      const { result } = renderHook(() => useTrailExpansion());

      act(() => result.current.toggle("activity-0"));
      act(() => result.current.toggle("activity-1"));
      act(() => result.current.toggle("activity-0"));

      expect(result.current.isOpen("activity-0")).toBe(false);
      expect(result.current.isOpen("activity-1")).toBe(true);
    });

    it("keeps the toggle callback stable so cards do not re-render on unrelated state", () => {
      const { result } = renderHook(() => useTrailExpansion());
      const firstToggle = result.current.toggle;

      act(() => result.current.toggle("activity-0"));

      expect(result.current.toggle).toBe(firstToggle);
    });

    it("keeps an opened group open as members stream in and the turn ends", () => {
      const members = [action("a"), action("b")];
      const { rerender } = render(<Trail members={members} />);

      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");

      // A new member arrives: the group's node identity is unchanged, so it
      // must not snap shut on the user mid-read.
      rerender(<Trail members={[...members, action("c")]} />);
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("c")).not.toBeNull();

      // The turn settles and the trail re-renders: still the user's call.
      rerender(<Trail members={[...members, action("c")]} />);
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    });
  });
});
