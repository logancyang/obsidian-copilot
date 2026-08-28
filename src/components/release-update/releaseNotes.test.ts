import {
  formatReleaseNotesForObsidian,
  loadLatestReleaseNotes,
} from "@/components/release-update/releaseNotes";
import * as obsidianModule from "obsidian";

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: jest.Mock) => void;
};

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";

describe("releaseNotes", () => {
  describe("formatReleaseNotesForObsidian()", () => {
    it(`matches GitHub reference labels without changing images or explicit Markdown links for ${ISSUE_URL}`, () => {
      const markdown = [
        "![Release image](https://github.com/user-attachments/assets/example)",
        "(https://github.com/logancyang/obsidian-copilot/pull/2988)",
        "[#2990](https://github.com/logancyang/obsidian-copilot/pull/2990)",
      ].join("\n\n");

      expect(formatReleaseNotesForObsidian(markdown)).toBe(
        [
          "![Release image](https://github.com/user-attachments/assets/example)",
          "([#2988](https://github.com/logancyang/obsidian-copilot/pull/2988))",
          "[#2990](https://github.com/logancyang/obsidian-copilot/pull/2990)",
        ].join("\n\n")
      );
    });
  });

  describe("loadLatestReleaseNotes()", () => {
    it(`returns the raw GitHub release body and durable URLs for ${ISSUE_URL}`, async () => {
      const requestUrlMock = jest.fn().mockResolvedValue({
        json: {
          tag_name: "v4.0.4",
          body: "![Release image](https://github.com/user-attachments/assets/example)",
          html_url: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
        },
      });
      setRequestUrlImpl(requestUrlMock);

      await expect(loadLatestReleaseNotes()).resolves.toEqual({
        version: "4.0.4",
        body: "![Release image](https://github.com/user-attachments/assets/example)",
        htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
      });
      expect(requestUrlMock).toHaveBeenCalledWith({
        url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest",
        method: "GET",
      });
    });

    it(`rejects an incomplete GitHub payload so the dialog can show its fallback for ${ISSUE_URL}`, async () => {
      setRequestUrlImpl(jest.fn().mockResolvedValue({ json: { tag_name: "4.0.4" } }));

      await expect(loadLatestReleaseNotes()).rejects.toThrow(
        "GitHub returned invalid release notes"
      );
    });
  });
});
