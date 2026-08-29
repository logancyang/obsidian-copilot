const GITHUB_REFERENCE_URL =
  /^https:\/\/github\.com\/logancyang\/obsidian-copilot\/(?:pull|issues)\/(\d+)$/;

/**
 * Compacts URL-only GitHub links after Obsidian has safely parsed the Markdown.
 * @param container - Rendered release-note content whose link labels may be shortened.
 */
export function formatReleaseNotesForObsidian(container: HTMLElement): void {
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    // Operate only on URL labels produced by Obsidian's linkifier; authored
    // labels, code, images, and HTML attributes remain untouched.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
    if (link.closest("code, pre")) continue;

    const href = link.getAttribute("href");
    if (!href || link.textContent !== href) continue;

    const reference = GITHUB_REFERENCE_URL.exec(href);
    if (reference) {
      link.textContent = `#${reference[1]}`;
    }
  }
}
