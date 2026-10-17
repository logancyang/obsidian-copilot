import { getVaultRelativeMiyoPath, isCurrentVaultMiyoPath } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import { getVaultBase, isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";
import type { App } from "obsidian";

// Search results name the active vault's notes by vault-relative path and other Miyo folders' notes
// by a path starting with the folder's name; saved chats still hold paths prefixed with the vault's
// name or absolute. Ticked extra folders can be told apart by name, but any other Miyo folder can't,
// so a link only gets a badge when it resolves to a note in this vault.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
function miyoVaultPath(app: App, raw: string): string | null {
  if (isAbsolutePath(raw)) {
    const relative = toVaultRelative(raw, getVaultBase(app));
    return relative === raw ? null : relative;
  }
  const relative = getVaultRelativeMiyoPath(app, raw);
  if (isCurrentVaultMiyoPath(app, raw)) return relative;
  return getSettings().miyoExtraSearchFolders.includes(relative.split("/")[0]) ? null : relative;
}

export function miyoVaultPaths(app: App, resultPaths: readonly string[]): Set<string> {
  const paths = new Set<string>();
  for (const raw of resultPaths) {
    const path = miyoVaultPath(app, raw);
    if (path) paths.add(path);
  }
  return paths;
}

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
