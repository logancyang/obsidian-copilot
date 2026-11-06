import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { Component } from "obsidian";
import * as React from "react";

export interface MarkdownProps {
  className?: string;
  nested?: boolean;
  onRendered?: (container: HTMLElement) => void;
  runDataviewQueries?: boolean;
  sourcePath: string;
  text: string;
}

export function Markdown({
  className,
  nested,
  onRendered,
  runDataviewQueries = false,
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
    if (!nested) target.classList.add("markdown-rendered");
    target.replaceChildren();
    void renderMarkdown(app, text, target, sourcePath, component, runDataviewQueries)
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
  }, [app, nested, onRendered, runDataviewQueries, sourcePath, text]);

  return <div className={cn(className)} ref={targetRef} />;
}
