import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { Component } from "obsidian";
import * as React from "react";

export interface MarkdownProps {
  className?: string;
  onRendered?: (container: HTMLElement) => void;
  sourcePath: string;
  text: string;
}

/**
 * Renders Markdown through Obsidian while owning the renderer's resource lifecycle.
 * @param props - Markdown content, link-resolution source, presentation classes, and optional post-render handling.
 */
export function Markdown({
  className,
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
    void renderMarkdown(app, text, target, sourcePath, component)
      .then(() => {
        // An obsolete render must not mutate the newer DOM through a post-render handler.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
        if (!cancelled) onRendered?.(target);
      })
      .catch((error: unknown) => {
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
  }, [app, onRendered, sourcePath, text]);

  return <div className={cn(className)} ref={targetRef} />;
}
