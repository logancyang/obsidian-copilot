import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("RecentChatTitle", () => {
  describe("RecentChatProjectBadge()", () => {
    it("labels the badge with the full project name in its accessible name and tooltip", () => {
      render(<RecentChatProjectBadge name="International product research" />);

      const badge = screen.getByLabelText("Project: International product research");
      expect(badge.getAttribute("title")).toBe("International product research");
      expect(badge.textContent).toBe("International product research");
    });
  });

  describe("RecentChatTitle()", () => {
    it("shows a long chat title with its full text available as a tooltip", () => {
      const title = "Do a research on Mobbin that explains how people express their app value";
      render(<RecentChatTitle title={title} />);

      expect(screen.getByText(title).getAttribute("title")).toBe(title);
    });
  });
});
