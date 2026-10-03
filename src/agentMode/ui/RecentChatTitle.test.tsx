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

    it("puts the agent's face before the title of a chat held with one", () => {
      const { container, rerender } = render(
        <RecentChatTitle
          title="Newsletter intro"
          agentFace={{ name: "jennifer", avatarSrc: null }}
        />
      );
      expect(container.textContent).toBe("JNewsletter intro");

      rerender(
        <RecentChatTitle
          title="Newsletter intro"
          agentFace={{ name: "Jennifer", avatarSrc: "app://jennifer/avatar.webp" }}
        />
      );
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "app://jennifer/avatar.webp"
      );
    });

    it("renders a Copilot chat's title with no leading glyph", () => {
      const { container } = render(<RecentChatTitle title="Newsletter intro" />);

      expect(container.textContent).toBe("Newsletter intro");
    });
  });
});
