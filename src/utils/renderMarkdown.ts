import { openVaultPath } from "@/utils/openVaultPath";
import { App, Component, Keymap, MarkdownRenderer } from "obsidian";

type ModernRender = (
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
) => Promise<void>;

// Dataview evaluates fenced code that starts with `=` as an inline query, appending parse errors to
// chat replies; its `?no-dataview` sourcePath marker keeps rendered model output literal.
// https://github.com/logancyang/obsidian-copilot/issues/3988
export function withoutDataview(sourcePath: string): string {
  return `${sourcePath}?no-dataview`;
}

export async function renderMarkdown(
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
): Promise<void> {
  const render = (MarkdownRenderer as unknown as { render: ModernRender }).render;
  await render(app, markdown, el, withoutDataview(sourcePath), component);
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
    let href: string;
    try {
      href = decodeURIComponent(raw);
    } catch {
      href = raw;
    }
    openVaultPath(app, href, { sourcePath, pane: Keymap.isModEvent(e) });
  };
  el.addEventListener("click", handleClick);
  el.addEventListener("auxclick", handleClick);
  component.register(() => {
    el.removeEventListener("click", handleClick);
    el.removeEventListener("auxclick", handleClick);
  });
}
