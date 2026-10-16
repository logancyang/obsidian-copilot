import { getSettings } from "@/settings/model";
import { getVaultBase, isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";
import type { App } from "obsidian";

// Miyo prefixes each path with the name of the Miyo folder it came from, or returns an absolute
// path, so only paths that land inside this vault may badge a link.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/719
function miyoVaultPath(app: App, raw: string): string | null {
  if (isAbsolutePath(raw)) {
    const relative = toVaultRelative(raw, getVaultBase(app));
    return relative === raw ? null : relative;
  }
  const [folder, ...rest] = raw.replace(/\\/g, "/").split("/");
  if (folder === app.vault.getName() && rest.length > 0) return rest.join("/");
  if (getSettings().miyoExtraSearchFolders.includes(folder)) return null;
  return raw;
}

export function miyoVaultPaths(app: App, resultPaths: readonly string[]): Set<string> {
  const paths = new Set<string>();
  for (const raw of resultPaths) {
    const path = miyoVaultPath(app, raw);
    if (path) paths.add(path);
  }
  return paths;
}

export function addMiyoBadgeHosts(
  app: App,
  container: HTMLElement,
  sourcePath: string,
  found: ReadonlySet<string>
): HTMLElement[] {
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
  return hosts;
}
