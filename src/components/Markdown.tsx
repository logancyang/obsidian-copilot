import { splitUiFences } from "@/intelligentUi/splitUiFences";
import { LayoutMarkdown } from "@/intelligentUi/ui/LayoutMarkdown";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { StreamingTextFade } from "@/utils/streamingTextFade";
import { Component } from "obsidian";
import * as React from "react";

export interface MarkdownProps {
  className?: string;
  nested?: boolean;
  onRendered?: (container: HTMLElement) => void;
  runDataviewQueries?: boolean;
  sourcePath: string;
  text: string;
  streaming?: boolean;
  textFade?: StreamingTextFade;
}

function MarkdownBody({
  className,
  nested,
  onRendered,
  runDataviewQueries = false,
  sourcePath,
  text,
  textFade,
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
        if (cancelled) return;
        textFade?.apply(target);
        onRendered?.(target);
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
  }, [app, nested, onRendered, runDataviewQueries, sourcePath, text, textFade]);

  return <div className={cn(className)} ref={targetRef} />;
}

export function Markdown(props: MarkdownProps): React.ReactElement {
  const ownFade = React.useRef<StreamingTextFade | undefined>(undefined);
  if (props.streaming && !ownFade.current) ownFade.current = new StreamingTextFade();
  // One tracker spans the switch to layout rendering, or prose already shown would fade in again. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
  const textFade = props.textFade ?? ownFade.current;
  if (
    splitUiFences(props.text, props.streaming ?? false).some((segment) => segment.kind === "layout")
  ) {
    return <LayoutMarkdown {...props} textFade={textFade} />;
  }
  return <MarkdownBody {...props} textFade={textFade} />;
}
