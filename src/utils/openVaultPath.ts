import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { getVaultBase, isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";
import { App } from "obsidian";

export interface OpenVaultPathOptions {
  newLeaf?: boolean;
  sourcePath?: string;
}

export function openVaultPath(app: App, rawPath: string, opts: OpenVaultPathOptions = {}): void {
  let path = toExistingRootRelativeVaultPath(app, rawPath) ?? rawPath;
  if (isAbsolutePath(path)) {
    const rel = toVaultRelative(path, getVaultBase(app));
    if (rel === path) {
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
        void openWithSystemDefault(resolved.absolutePath);
      }
      return;
    }
  }
  void app.workspace.openLinkText(path, opts.sourcePath ?? "", opts.newLeaf ?? false);
}

interface UnindexedPathResolution {
  absolutePath: string;
  indexedPath: string | null;
}

function resolveUnindexedVaultPath(app: App, filePath: string): UnindexedPathResolution | null {
  const vaultBase = getVaultBase(app);
  if (!vaultBase) return null;
  try {
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
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
