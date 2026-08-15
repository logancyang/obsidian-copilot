import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { requireNodeModule } from "@/utils/desktopRuntime";
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
 * Paths Obsidian doesn't index — symlink aliases like `.claude/skills/...`
 * and files under dotfile folders — are resolved against the real filesystem
 * on desktop: an alias whose target is an indexed note opens in the editor
 * under its canonical path, and an existing-but-unindexed file opens via the
 * OS instead of tripping `openLinkText`'s create-note flow.
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
  const { filePath, anchor } = splitAnchor(path);
  if (filePath && !app.vault.getAbstractFileByPath(filePath)) {
    const resolved = resolveUnindexedVaultPath(app, filePath);
    if (resolved) {
      if (resolved.indexedPath) {
        void app.workspace.openLinkText(
          resolved.indexedPath + anchor,
          opts.sourcePath ?? "",
          opts.newLeaf ?? false
        );
      } else {
        // Exists on disk but Obsidian can't index it (dotfile folder, or the
        // alias escapes the vault) — openLinkText would create a phantom note.
        void openWithSystemDefault(resolved.absolutePath);
      }
      return;
    }
  }
  void app.workspace.openLinkText(path, opts.sourcePath ?? "", opts.newLeaf ?? false);
}

interface UnindexedPathResolution {
  /** Fully symlink-resolved absolute filesystem path. */
  absolutePath: string;
  /** Canonical vault-relative path when the target is an indexed file. */
  indexedPath: string | null;
}

/**
 * Resolve a vault-relative path that Obsidian's index doesn't know about by
 * following symlinks in every path component on disk. Returns null on mobile,
 * or when the path doesn't exist — a missing target must keep flowing through
 * `openLinkText` so intentional links to not-yet-created notes still work.
 *
 * @param app The Obsidian `App` used for the vault base and index lookups.
 * @param filePath Vault-relative path with any `#anchor` already stripped.
 */
function resolveUnindexedVaultPath(app: App, filePath: string): UnindexedPathResolution | null {
  const vaultBase = getVaultBase(app);
  if (!vaultBase) return null;
  try {
    // Desktop-only: loaded lazily after the vault-base guard, which is null
    // wherever the FileSystemAdapter (and thus node) is unavailable.
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    // Realpath both sides so a vault base that itself sits behind a symlink
    // (e.g. /tmp on macOS) still compares equal to the resolved target.
    const absolutePath = fs.realpathSync(`${vaultBase}/${filePath}`);
    const canonicalBase = fs.realpathSync(vaultBase);
    const rel = toVaultRelative(absolutePath, canonicalBase);
    if (rel === absolutePath) return { absolutePath, indexedPath: null };
    return {
      absolutePath,
      indexedPath: app.vault.getAbstractFileByPath(rel) ? rel : null,
    };
  } catch {
    return null;
  }
}

function splitAnchor(path: string): { filePath: string; anchor: string } {
  const anchorIndex = path.indexOf("#");
  if (anchorIndex === -1) return { filePath: path, anchor: "" };
  return { filePath: path.slice(0, anchorIndex), anchor: path.slice(anchorIndex) };
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
  const { filePath } = splitAnchor(rel);
  if (!filePath) return null;
  return app.vault.getAbstractFileByPath(filePath) || resolveUnindexedVaultPath(app, filePath)
    ? rel
    : null;
}
