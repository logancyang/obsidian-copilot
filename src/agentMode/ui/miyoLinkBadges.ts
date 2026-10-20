import type { App } from "obsidian";

export const EMPTY_BADGE_HOSTS: readonly HTMLElement[] = Object.freeze([]);

export function addMiyoBadgeHosts(
  app: App,
  container: HTMLElement,
  sourcePath: string,
  found: ReadonlySet<string>
): readonly HTMLElement[] {
  const hosts: HTMLElement[] = [];
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a.internal-link")) {
    const raw = link.getAttribute("data-href") || link.getAttribute("href") || "";
    let href: string;
    try {
      href = decodeURIComponent(raw);
    } catch {
      href = raw;
    }
    const file = app.metadataCache.getFirstLinkpathDest(href.split("#")[0], sourcePath);
    if (!file || !found.has(file.path)) continue;
    const host = container.createSpan();
    link.before(host);
    hosts.push(host);
  }
  return hosts.length > 0 ? hosts : EMPTY_BADGE_HOSTS;
}
