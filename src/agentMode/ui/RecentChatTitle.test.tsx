import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("RecentChatTitle", () => {
  describe("RecentChatProjectBadge()", () => {
    it("preserves the full project name in its text and accessible label", () => {
      render(<RecentChatProjectBadge name="International product research" />);

      const badge = screen.getByLabelText("Project: International product research");
      expect(badge.getAttribute("title")).toBe("International product research");
      expect(badge.textContent).toBe("International product research");
    });
  });

  describe("RecentChatTitle()", () => {
    it("preserves the full conversation title and hover label", () => {
      const title = "Do a research on Mobbin that explains how people express their app value";
      render(<RecentChatTitle title={title} />);

      const titleElement = screen.getByText(title);
      expect(titleElement.getAttribute("title")).toBe(title);
    });
  });
});
