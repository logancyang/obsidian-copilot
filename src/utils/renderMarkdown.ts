import { openVaultPath } from "@/utils/openVaultPath";
import { App, Component, MarkdownRenderer } from "obsidian";

/**
 * Thin wrapper around the modern `MarkdownRenderer.render(app, …)` API.
 *
 * Reason for the cast: the `obsidian@^1.2.5` package pinned in
 * `package.json` only declares the deprecated
 * `MarkdownRenderer.renderMarkdown(...)` static. The modern
 * `MarkdownRenderer.render(app, …)` signature has existed at runtime since
 * Obsidian 1.4.6 — well below our `minAppVersion: 1.11.4` — but the
 * bundled `.d.ts` lacks it. Passing `app` lets the renderer resolve
 * `![[embeds]]` and produce proper `data-href` attributes on
 * `a.internal-link`. It does **not** wire click handlers — Obsidian's
 * internal-link click delegate (`registerDomEvents`) is only attached to
 * the workspace's `markdown-preview-view`, in-process markdown-embed,
 * and CodeMirror `contentDOM`. Markdown rendered into a plain `<div>`
 * inside an `ItemView` (chat panel, agent panel, plan preview) never
 * reaches that delegate, so we attach our own.
 *
 * Resolved at call time (not import time) so jest mocks that don't expose
 * `MarkdownRenderer` at all can still load this module.
 */
type ModernRender = (
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
) => Promise<void>;

export async function renderMarkdown(
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
): Promise<void> {
  const render = (MarkdownRenderer as unknown as { render: ModernRender }).render;
  await render(app, markdown, el, sourcePath, component);
  wireInternalLinks(el, app, sourcePath, component);
}

/**
 * Delegated handler that routes `a.internal-link` clicks inside `el` to
 * `app.workspace.openLinkText`. Tied to `component`'s lifecycle so the
 * listener dies when the caller unloads the component. Left-click opens
 * in the current pane; middle-click / cmd-click / ctrl-click opens in a
 * new tab — matching Obsidian's own behavior.
 */
function wireInternalLinks(
  el: HTMLElement,
  app: App,
  sourcePath: string,
  component: Component
): void {
  const handleClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest?.("a.internal-link") as HTMLAnchorElement | null;
    if (!link || !el.contains(link)) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    const raw = link.getAttribute("data-href") || link.getAttribute("href");
    if (!raw) return;
    // Coding agents that run with the vault as their cwd emit links with the
    // note's absolute on-disk path (e.g. `/Users/me/Vault/Inbox/Foo.md`).
    // `openLinkText` resolves its target relative to the vault root, dropping
    // the leading slash — so an absolute path outside the vault would
    // materialize the whole `Users/me/...` folder chain as a phantom note.
    // `openVaultPath` routes those to the OS instead. Decode first: the DOM
    // href is percent-encoded (`Foo%20Bar.md`), unlike a raw filesystem path.
    let href = raw;
    try {
      href = decodeURIComponent(raw);
    } catch {
      // keep raw on malformed percent escapes
    }
    const newLeaf = e.button === 1 || e.ctrlKey || e.metaKey;
    openVaultPath(app, href, { newLeaf, sourcePath });
  };
  el.addEventListener("click", handleClick);
  el.addEventListener("auxclick", handleClick);
  component.register(() => {
    el.removeEventListener("click", handleClick);
    el.removeEventListener("auxclick", handleClick);
  });
}
