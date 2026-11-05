import { openVaultPath } from "@/utils/openVaultPath";
import { App, Component, Keymap, MarkdownRenderer } from "obsidian";

type ModernRender = (
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
) => Promise<void>;

interface DataviewApi {
  execute(
    source: string,
    container: HTMLElement,
    component: Component,
    filePath: string
  ): Promise<void>;
}

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
  component: Component,
  runDataviewQueries = false
): Promise<void> {
  const render = (MarkdownRenderer as unknown as { render: ModernRender }).render;
  await render(app, markdown, el, withoutDataview(sourcePath), component);
  if (runDataviewQueries) renderDataviewQueries(app, el, sourcePath, component);
  wireInternalLinks(el, app, sourcePath, component);
}

// Agent Chat replies still show live results for `dataview` (DQL) blocks under the `?no-dataview` marker;
// `dataviewjs` blocks stay as source because running them would execute model-written JavaScript.
// https://github.com/logancyang/obsidian-copilot/issues/3988
function renderDataviewQueries(
  app: App,
  el: HTMLElement,
  sourcePath: string,
  component: Component
): void {
  const { plugins } = app as unknown as {
    plugins?: { getPlugin(id: string): { api?: DataviewApi } | null };
  };
  const api = plugins?.getPlugin("dataview")?.api;
  if (!api) return;
  el.querySelectorAll<HTMLElement>(".block-language-dataview").forEach((block) => {
    const source = block.textContent ?? "";
    block.replaceChildren();
    void api.execute(source, block, component, sourcePath);
  });
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
