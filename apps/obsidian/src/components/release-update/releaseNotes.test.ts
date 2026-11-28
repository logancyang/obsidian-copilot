import {
  findReleaseVideo,
  formatReleaseNotesForObsidian,
  requestReleaseNotesSince,
} from "@/components/release-update/releaseNotes";
import { requestUrl, type RequestUrlResponse } from "obsidian";

jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const ISSUE_600_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/600";
const REFERENCE_URL = "https://github.com/logancyang/obsidian-copilot/pull/2988";
const VIDEO_ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/603";

describe("releaseNotes", () => {
  describe("findReleaseVideo()", () => {
    it(`returns the thumbnail, title, and link of the image whose alt text starts with "Demo video:" for ${VIDEO_ISSUE_URL}`, () => {
      const body = [
        "# v4.0.12 - OpenCode 2 in your vault",
        "[![Demo video: OpenCode 2 in Your Vault](https://github.com/user-attachments/assets/thumb)](https://www.youtube.com/shorts/IjjXVFNFO0k)",
        "![Copilot icon in the note header](https://github.com/user-attachments/assets/screenshot)",
      ].join("\n\n");

      expect(findReleaseVideo(body)).toEqual({
        thumbnailUrl: "https://github.com/user-attachments/assets/thumb",
        title: "OpenCode 2 in Your Vault",
        url: "https://www.youtube.com/shorts/IjjXVFNFO0k",
      });
    });

    it(`returns null when no linked image carries the "Demo video:" keyword for ${VIDEO_ISSUE_URL}`, () => {
      const body =
        "[![OpenCode 2 in Your Vault](https://github.com/user-attachments/assets/thumb)](https://www.youtube.com/shorts/IjjXVFNFO0k)";

      expect(findReleaseVideo(body)).toBeNull();
    });
  });

  describe("formatReleaseNotesForObsidian()", () => {
    it(`compacts only rendered URL labels without rewriting Markdown syntax for ${ISSUE_URL}`, () => {
      const container = document.createElement("div");
      const appendLink = (parent: HTMLElement, label: string): void => {
        const link = document.createElement("a");
        link.href = REFERENCE_URL;
        link.textContent = label;
        parent.append(link);
      };
      appendLink(container, REFERENCE_URL);
      appendLink(container, "Notification fix");
      appendLink(container.appendChild(document.createElement("code")), REFERENCE_URL);
      appendLink(container.appendChild(document.createElement("pre")), REFERENCE_URL);
      const image = container.appendChild(document.createElement("img"));
      image.alt = "Release image";
      image.src = "https://github.com/user-attachments/assets/example";
      const span = container.appendChild(document.createElement("span"));
      span.dataset.reference = REFERENCE_URL;
      span.textContent = "HTML content";

      formatReleaseNotesForObsidian(container);

      const links = container.querySelectorAll("a");
      expect(links[0]).toMatchObject({ href: REFERENCE_URL, textContent: "#2988" });
      expect(links[1]).toMatchObject({ href: REFERENCE_URL, textContent: "Notification fix" });
      expect(links[2]).toMatchObject({ href: REFERENCE_URL, textContent: REFERENCE_URL });
      expect(links[3]).toMatchObject({ href: REFERENCE_URL, textContent: REFERENCE_URL });
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "https://github.com/user-attachments/assets/example"
      );
      expect(container.querySelector("span")?.getAttribute("data-reference")).toBe(REFERENCE_URL);
    });
  });

  describe("requestReleaseNotesSince()", () => {
    const LATEST = {
      body: "# v4.0.11",
      htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.11",
      version: "4.0.11",
    };
    const listItem = (tag: string, extra: Record<string, unknown> = {}) => ({
      body: `# ${tag}`,
      draft: false,
      html_url: `https://github.com/logancyang/obsidian-copilot/releases/tag/${tag}`,
      prerelease: false,
      tag_name: tag,
      ...extra,
    });
    const respond = (json: unknown): RequestUrlResponse =>
      ({ json }) as unknown as RequestUrlResponse;

    beforeEach(() => {
      jest.mocked(requestUrl).mockReset();
    });

    it(`returns the latest release followed by each skipped stable release, newest first, for ${ISSUE_600_URL}`, async () => {
      jest
        .mocked(requestUrl)
        .mockResolvedValue(
          respond([
            listItem("4.0.12-canary.1", { prerelease: true }),
            listItem("4.0.11"),
            listItem("4.0.9"),
            listItem("v4.0.10"),
            listItem("4.0.10-draft", { draft: true }),
            listItem("4.0.8"),
            listItem("4.0.7"),
          ])
        );

      const releases = await requestReleaseNotesSince("4.0.8", LATEST);

      expect(releases).toEqual([
        LATEST,
        {
          body: "# v4.0.10",
          htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/v4.0.10",
          version: "4.0.10",
        },
        {
          body: "# 4.0.9",
          htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.9",
          version: "4.0.9",
        },
      ]);
      expect(requestUrl).toHaveBeenCalledWith({
        url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases?per_page=30&page=1",
        method: "GET",
      });
    });

    it(`reads further pages when prereleases fill the first page, stopping at the installed version, for ${ISSUE_600_URL}`, async () => {
      const canaries = Array.from({ length: 29 }, (_, index) =>
        listItem(`4.0.11-canary.${index}`, { prerelease: true })
      );
      jest
        .mocked(requestUrl)
        .mockResolvedValueOnce(respond([...canaries, listItem("4.0.10")]))
        .mockResolvedValueOnce(respond([listItem("4.0.9"), listItem("4.0.8")]));

      const releases = await requestReleaseNotesSince("4.0.8", LATEST);

      expect(releases.map((release) => release.version)).toEqual(["4.0.11", "4.0.10", "4.0.9"]);
      expect(requestUrl).toHaveBeenCalledTimes(2);
      expect(requestUrl).toHaveBeenLastCalledWith({
        url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases?per_page=30&page=2",
        method: "GET",
      });
    });

    it(`leaves out the latest release by its URL when its tag differs from its manifest version for ${ISSUE_600_URL}`, async () => {
      const latest = {
        body: "# v4.0.4",
        htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.3",
        version: "4.0.4",
      };
      jest
        .mocked(requestUrl)
        .mockResolvedValue(respond([listItem("4.0.3"), listItem("4.0.2"), listItem("4.0.1")]));

      const releases = await requestReleaseNotesSince("4.0.1", latest);

      expect(releases.map((release) => release.version)).toEqual(["4.0.4", "4.0.2"]);
    });

    it(`caps the notes at ten releases for a user many versions behind for ${ISSUE_600_URL}`, async () => {
      const tags = Array.from({ length: 15 }, (_, index) => `3.${index}.0`);
      jest.mocked(requestUrl).mockResolvedValue(respond(tags.map((tag) => listItem(tag))));

      const releases = await requestReleaseNotesSince("2.0.0", LATEST);

      expect(releases.map((release) => release.version)).toEqual([
        "4.0.11",
        "3.14.0",
        "3.13.0",
        "3.12.0",
        "3.11.0",
        "3.10.0",
        "3.9.0",
        "3.8.0",
        "3.7.0",
        "3.6.0",
      ]);
    });

    it(`falls back to only the latest release when GitHub's release list cannot be read for ${ISSUE_600_URL}`, async () => {
      jest.mocked(requestUrl).mockRejectedValue(new Error("rate limited"));

      await expect(requestReleaseNotesSince("4.0.8", LATEST)).resolves.toEqual([LATEST]);
    });
  });
});
