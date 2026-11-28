import { logError } from "@/logger";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { getVaultBase, isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";
import { App, Keymap, PaneType, TFile, WorkspaceLeaf } from "obsidian";
import type { MouseEvent as ReactMouseEvent } from "react";

export type OpenPane = PaneType | boolean;

export interface OpenVaultPathOptions {
  sourcePath?: string;
  pane?: OpenPane;
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
  // Bare PDF destinations inherit the previous vertical offset: https://github.com/logancyang/obsidian-copilot/issues/3894
  path = path.replace(/(\.pdf#page=\d+)$/i, "$1&offset=0,,0");
  const { filePath, anchor } = splitAnchor(path);
  if (filePath && !app.vault.getAbstractFileByPath(filePath)) {
    const resolved = resolveUnindexedVaultPath(app, filePath);
    if (resolved) {
      if (resolved.indexedPath) {
        openLinkText(app, resolved.indexedPath + anchor, opts);
      } else {
        void openWithSystemDefault(resolved.absolutePath);
      }
      return;
    }
  }
  openLinkText(app, path, opts);
}

export async function openFileInTab(app: App, file: TFile, pane: OpenPane = false): Promise<void> {
  const openLeaf = findReusableLeaf(app, file, pane);
  if (openLeaf) return focusLeaf(app, openLeaf, file, "");
  await app.workspace.getLeaf(pane || "tab").openFile(file);
}

export function openLinkClickProps(open: (pane: OpenPane) => void): {
  onClick: (event: ReactMouseEvent) => void;
  onAuxClick: (event: ReactMouseEvent) => void;
} {
  const handle = (event: ReactMouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    open(Keymap.isModEvent(event.nativeEvent));
  };
  return {
    onClick: handle,
    onAuxClick: (event) => {
      if (event.button === 1) handle(event);
    },
  };
}

function openLinkText(app: App, linkText: string, opts: OpenVaultPathOptions): void {
  const sourcePath = opts.sourcePath ?? "";
  const pane = opts.pane ?? false;
  const { filePath, anchor } = splitAnchor(linkText);
  const file = app.metadataCache.getFirstLinkpathDest(filePath, sourcePath);
  const openLeaf = file ? findReusableLeaf(app, file, pane) : undefined;
  if (file && openLeaf) {
    focusLeaf(app, openLeaf, file, anchor).catch((error: unknown) =>
      logError("[openVaultPath] failed to focus the open note", error)
    );
    return;
  }
  void app.workspace.openLinkText(linkText, sourcePath, pane || "tab");
}

function findReusableLeaf(app: App, file: TFile, pane: OpenPane): WorkspaceLeaf | undefined {
  // Cmd/Ctrl-click and middle-click ask for a new tab, so they skip reusing the open one: https://github.com/Brevilabs/obsidian-copilot-private/issues/796
  if (pane) return undefined;
  const { leftSplit, rightSplit } = app.workspace;
  const leaves: WorkspaceLeaf[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    const root = leaf.getRoot();
    if (root === leftSplit || root === rightSplit) return;
    if ((leaf.getViewState().state as { file?: unknown } | undefined)?.file === file.path)
      leaves.push(leaf);
  });
  return leaves[0];
}

async function focusLeaf(
  app: App,
  leaf: WorkspaceLeaf,
  file: TFile,
  anchor: string
): Promise<void> {
  // A tab restored at startup stays unloaded; revealing or scrolling it before it loads loses the scroll.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/796
  await (leaf as WorkspaceLeaf & { loadIfDeferred(): Promise<void> }).loadIfDeferred();
  app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  if (anchor) await leaf.openFile(file, { eState: { subpath: anchor } });
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
