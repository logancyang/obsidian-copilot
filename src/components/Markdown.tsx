import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { Component } from "obsidian";
import * as React from "react";

export interface MarkdownProps {
  className?: string;
  sourcePath: string;
  text: string;
}

/**
 * Renders Markdown through Obsidian while owning the renderer's resource lifecycle.
 * @param props - Markdown content, link-resolution source, and optional presentation classes.
 */
export function Markdown({ className, sourcePath, text }: MarkdownProps): React.ReactElement {
  const app = useApp();
  const targetRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const component = new Component();
    let cancelled = false;
    component.load();
    target.replaceChildren();
    void renderMarkdown(app, text, target, sourcePath, component).catch((error: unknown) => {
      // Markdown content must remain readable when Obsidian's renderer fails.
      // Ignore an obsolete render so it cannot replace newer content.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
      if (cancelled) return;
      logWarn("[Markdown] render failed", error);
      target.textContent = text;
    });

    return () => {
      cancelled = true;
      component.unload();
      target.replaceChildren();
    };
  }, [app, sourcePath, text]);

  return <div className={cn("markdown-rendered", className)} ref={targetRef} />;
}
