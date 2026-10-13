import { TurnDiffHeader } from "@/agentMode/ui/TurnDiffHeader";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("TurnDiffHeader", () => {
  describe("TurnDiffHeader", () => {
    it("names the file, its status and its line counts", () => {
      render(
        <TurnDiffHeader
          path="notes/diff-demo/meeting.md"
          status="created"
          additions={28}
          deletions={0}
        />
      );

      expect(screen.getByTitle("notes/diff-demo/meeting.md").textContent).toBe(
        "notes/diff-demo/meeting.md"
      );
      expect(screen.getByText("new")).toBeTruthy();
      expect(screen.getByText("+28")).toBeTruthy();
      expect(screen.getByText("−0")).toBeTruthy();
    });

    it("places the status badge before the counts, the order the card's rows use", () => {
      const { container } = render(
        <TurnDiffHeader path="notes/a.md" status="deleted" additions={0} deletions={9} />
      );

      const badge = screen.getByText("deleted");
      const counts = screen.getByText("−9");
      expect(badge.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.textContent).toContain("deleted");
    });

    it("runs the caller's handler when Open note is chosen", () => {
      const onOpenNote = jest.fn();
      render(
        <TurnDiffHeader
          path="notes/a.md"
          status="modified"
          additions={1}
          deletions={1}
          onOpenNote={onOpenNote}
        />
      );

      fireEvent.click(screen.getByText("Open note"));

      expect(onOpenNote).toHaveBeenCalledTimes(1);
    });

    it("counts the changes before the reader has moved to one, then shows which change is current", () => {
      const header = (current: number | null): React.ReactElement => (
        <TurnDiffHeader
          path="notes/a.md"
          status="modified"
          additions={3}
          deletions={2}
          changes={{ current, total: 6, onStep: jest.fn() }}
        />
      );
      const { rerender } = render(header(null));
      expect(screen.getByText("6 changes")).toBeTruthy();

      rerender(header(1));

      expect(screen.getByText("2 of 6")).toBeTruthy();
    });

    it("steps back for the previous arrow and forward for the next arrow", () => {
      const onStep = jest.fn();
      render(
        <TurnDiffHeader
          path="notes/a.md"
          status="modified"
          additions={1}
          deletions={1}
          changes={{ current: null, total: 1, onStep }}
        />
      );
      expect(screen.getByText("1 change")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
      fireEvent.click(screen.getByRole("button", { name: "Next change" }));

      expect(onStep.mock.calls).toEqual([[-1], [1]]);
    });

    it("shows no stepper while the note has no changes to step through", () => {
      render(
        <TurnDiffHeader
          path="notes/a.md"
          status="modified"
          additions={1}
          deletions={1}
          changes={{ current: null, total: 0, onStep: jest.fn() }}
        />
      );

      expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
    });

    it("offers no Open note when the caller gives no handler, as for a deleted file", () => {
      render(<TurnDiffHeader path="notes/a.md" status="deleted" additions={0} deletions={9} />);

      expect(screen.queryByText("Open note")).toBeNull();
    });
  });
});
