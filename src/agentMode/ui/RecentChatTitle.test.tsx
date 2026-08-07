import { RecentChatProjectBadge, RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("RecentChatTitle", () => {
  describe("RecentChatProjectBadge()", () => {
    it("preserves the full project name while constraining its visible width", () => {
      render(<RecentChatProjectBadge name="International product research" />);

      const badge = screen.getByLabelText("Project: International product research");
      expect(badge.getAttribute("title")).toBe("International product research");
      expect(badge.classList.contains("tw-max-w-24")).toBe(true);
      expect(badge.classList.contains("tw-shrink-0")).toBe(true);
      expect(badge.querySelector("span")?.classList.contains("tw-truncate")).toBe(true);
    });
  });

  describe("RecentChatTitle()", () => {
    it("uses an explicit ellipsis contract while preserving the full title", () => {
      const title = "Do a research on Mobbin that explains how people express their app value";
      render(<RecentChatTitle title={title} projectName="Research" />);

      const titleElement = screen.getByText(title);
      expect(titleElement.classList.contains("tw-block")).toBe(true);
      expect(titleElement.classList.contains("tw-truncate")).toBe(true);
      expect(titleElement.getAttribute("title")).toBe(title);
      expect(screen.getByLabelText("Project: Research")).toBeTruthy();
    });

    it("omits the project badge when no project name is available", () => {
      render(<RecentChatTitle title="Global chat" />);

      expect(screen.queryByLabelText(/^Project:/)).toBeNull();
    });
  });
});
