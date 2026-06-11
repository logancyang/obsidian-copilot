import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { getVaultBase, isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";
import { App } from "obsidian";

export interface OpenVaultPathOptions {
  /** Open in a new tab (middle/cmd/ctrl-click). Defaults to false. */
  newLeaf?: boolean;
  /** Source note for link resolution, passed through to `openLinkText`. */
  sourcePath?: string;
}

/**
 * Open a path emitted by a coding agent. Relative paths and absolute paths
 * inside the vault route through `openLinkText`; absolute paths outside the
 * vault are handed to the OS default app so `openLinkText` can't fabricate a
 * phantom note + folder chain from an unresolved target. Shared by every
 * agent-response surface that turns a path into a click target (rendered
 * markdown links, tool-call cards).
 *
 * Callers that source the path from a URL-encoded DOM `href` must
 * `decodeURIComponent` first — decoding is correct only for encoded hrefs,
 * not for raw filesystem paths (a real file can contain a literal `%`).
 */
export function openVaultPath(app: App, rawPath: string, opts: OpenVaultPathOptions = {}): void {
  let path = toExistingRootRelativeVaultPath(app, rawPath) ?? rawPath;
  if (isAbsolutePath(path)) {
    const rel = toVaultRelative(path, getVaultBase(app));
    if (rel === path) {
      // Absolute path outside the vault — don't let openLinkText fabricate a
      // phantom note; hand off to the OS default app instead.
      void openWithSystemDefault(path);
      return;
    }
    path = rel;
  }
  void app.workspace.openLinkText(path, opts.sourcePath ?? "", opts.newLeaf ?? false);
}

/**
 * If `href` is a root-relative link (`/Folder/Foo.md`, optionally with a
 * `#heading`) whose file actually exists in the vault, return it stripped of
 * the leading slash so `openLinkText` resolves it. Returns null otherwise so
 * the caller can fall through to absolute-path handling.
 */
function toExistingRootRelativeVaultPath(app: App, href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const rel = href.replace(/^\/+/, "");
  if (!rel) return null;
  const anchorIndex = rel.indexOf("#");
  const filePath = anchorIndex === -1 ? rel : rel.slice(0, anchorIndex);
  if (!filePath) return null;
  return app.vault.getAbstractFileByPath(filePath) ? rel : null;
}
