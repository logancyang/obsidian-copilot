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

    it("offers no Open note when the caller gives no handler, as for a deleted file", () => {
      render(<TurnDiffHeader path="notes/a.md" status="deleted" additions={0} deletions={9} />);

      expect(screen.queryByText("Open note")).toBeNull();
    });
  });
});
