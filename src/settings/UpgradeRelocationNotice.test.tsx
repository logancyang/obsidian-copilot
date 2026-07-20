import { UpgradeRelocationNotice } from "@/settings/UpgradeRelocationNotice";
import type { FolderRelocationEntry } from "@/settings/upgradeNotice";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("UpgradeRelocationNotice", () => {
  describe("UpgradeRelocationNotice()", () => {
    it("renders the heading and states that files were not moved", () => {
      render(<UpgradeRelocationNotice entries={[]} />);
      expect(screen.getByRole("heading", { name: "Copilot folders have moved" })).not.toBeNull();
      expect(screen.getByText(/weren.t moved/)).not.toBeNull();
    });

    it("lists each entry as an old-to-new path pair", () => {
      const entries: FolderRelocationEntry[] = [
        {
          label: "Chat conversations",
          oldPath: "old/chats",
          newPath: "copilot/copilot-conversations",
        },
        { label: "Agent skills", oldPath: "old/skills", newPath: "copilot/skills" },
      ];
      render(<UpgradeRelocationNotice entries={entries} />);
      // Each entry contributes a list item carrying its old and new paths.
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toBe(
        "Chat conversations: old/chats → copilot/copilot-conversations"
      );
      expect(items[1].textContent).toBe("Agent skills: old/skills → copilot/skills");
    });
  });
});
