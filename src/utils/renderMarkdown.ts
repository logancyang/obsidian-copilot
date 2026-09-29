import { openVaultPath } from "@/utils/openVaultPath";
import { App, Component, MarkdownRenderer } from "obsidian";

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
    let href = raw;
    try {
      href = decodeURIComponent(raw);
    } catch {}
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
