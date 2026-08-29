import { formatReleaseNotesForObsidian } from "@/components/release-update/releaseNotes";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const REFERENCE_URL = "https://github.com/logancyang/obsidian-copilot/pull/2988";

describe("releaseNotes", () => {
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
});
