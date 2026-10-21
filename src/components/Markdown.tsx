import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { withBlankLineBreaks } from "@/utils/markdownSections";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { type App, Component } from "obsidian";
import * as React from "react";

export interface MarkdownProps {
  className?: string;
  keepBlankLines?: boolean;
  onRendered?: (container: HTMLElement) => void;
  sourcePath: string;
  text: string;
}

export function Markdown({
  className,
  keepBlankLines = false,
  onRendered,
  sourcePath,
  text,
}: MarkdownProps): React.ReactElement {
  const app = useApp();
  const targetRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const component = new Component();
    let cancelled = false;
    component.load();
    target.classList.add("markdown-rendered");
    target.replaceChildren();
    const render = async (): Promise<void> => {
      const markdown = keepBlankLines ? await markdownWithBlankLines(app, text) : text;
      // A parse that lands after cleanup would render into a target a newer render now owns.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/751
      if (cancelled) return;
      await renderMarkdown(app, markdown, target, sourcePath, component);
    };
    void render()
      .then(() => {
        if (!cancelled) onRendered?.(target);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logWarn("[Markdown] render failed", error);
        target.textContent = text;
      });

    return () => {
      cancelled = true;
      component.unload();
      target.replaceChildren();
    };
  }, [app, keepBlankLines, onRendered, sourcePath, text]);

  return <div className={cn(className)} ref={targetRef} />;
}

async function markdownWithBlankLines(app: App, text: string): Promise<string> {
  try {
    return await withBlankLineBreaks(app, text);
  } catch (error) {
    // Obsidian's parser is a private API that may disappear; the text still renders, only the
    // extra blank lines collapse. https://github.com/Brevilabs/obsidian-copilot-private/issues/751
    logWarn("[Markdown] blank-line parsing failed, rendering without them", error);
    return text;
  }
}
