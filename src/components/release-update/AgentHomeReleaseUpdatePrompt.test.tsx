import { AgentHomeReleaseUpdatePrompt } from "@/components/release-update/AgentHomeReleaseUpdatePrompt";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const VIDEO_ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/603";
const VIDEO = {
  thumbnailUrl: "https://github.com/user-attachments/assets/video-thumbnail",
  title: "OpenCode 2 in Your Vault",
  url: "https://www.youtube.com/shorts/IjjXVFNFO0k",
};

describe("AgentHomeReleaseUpdatePrompt", () => {
  describe("AgentHomeReleaseUpdatePrompt()", () => {
    it(`renders the large bottom banner requested in ${ISSUE_URL}`, () => {
      const onDismiss = jest.fn();
      const onOpen = jest.fn();

      render(
        <AgentHomeReleaseUpdatePrompt
          onDismiss={onDismiss}
          onOpen={onOpen}
          version="4.0.4"
          video={null}
        />
      );

      const prompt = screen.getByRole("status");
      expect(prompt.getAttribute("data-agent-home-release-update")).toBe("bottom-banner");
      expect(prompt.classList.contains("tw-inset-x-0")).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "See what’s new" }));
      fireEvent.click(screen.getByRole("button", { name: "Dismiss release update" }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: /^Watch demo video/ })).toBeNull();
    });

    it(`previews the demo video thumbnail as a link to the video for ${VIDEO_ISSUE_URL}`, () => {
      render(
        <AgentHomeReleaseUpdatePrompt
          onDismiss={jest.fn()}
          onOpen={jest.fn()}
          version="4.0.12"
          video={VIDEO}
        />
      );

      const link = screen.getByRole("link", { name: `Watch demo video: ${VIDEO.title}` });
      expect(link.getAttribute("href")).toBe(VIDEO.url);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.querySelector("img")?.getAttribute("src")).toBe(VIDEO.thumbnailUrl);
    });
  });
});
