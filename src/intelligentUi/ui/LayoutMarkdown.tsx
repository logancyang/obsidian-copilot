import { nativeUiSources } from "@/intelligentUi/nativeSources";
import { useApp } from "@/context";
import { splitUiFences } from "@/intelligentUi/splitUiFences";
import { UiFence } from "@/intelligentUi/ui/UiFence";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { Component } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface LayoutMarkdownProps {
  text: string;
  sourcePath: string;
  streaming?: boolean;
  className?: string;
  nested?: boolean;
  runDataviewQueries?: boolean;
  onRendered?: (container: HTMLElement) => void;
}
interface LayoutHost {
  source: string;
  closed: boolean;
  element: HTMLElement;
  streaming: boolean;
}
const EMPTY_HOSTS: readonly LayoutHost[] = Object.freeze([]);

export function LayoutMarkdown({
  text,
  sourcePath,
  streaming = false,
  className,
  nested,
  runDataviewQueries = false,
  onRendered,
}: LayoutMarkdownProps) {
  const app = useApp();
  const targetRef = useRef<HTMLDivElement>(null);
  const currentHosts = useRef<readonly LayoutHost[]>(EMPTY_HOSTS);
  const [hosts, setHosts] = useState<readonly LayoutHost[]>(EMPTY_HOSTS);
  useEffect(() => {
    const target = targetRef.current!;
    const staging = target.doc.win.createDiv();
    const owner = new Component();
    let cancelled = false;
    let settled = false;
    owner.load();
    const active = splitUiFences(text, streaming).find(
      (segment) => segment.kind === "layout" && !segment.closed
    );
    const activeSource = active?.source.replace(/\n$/, "");
    // Full-document Markdown preserves references across layouts; detached rendering withholds temporary processor fallbacks. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
    void renderMarkdown(app, text, staging, sourcePath, owner, runDataviewQueries)
      .then(() => {
        if (cancelled) return;
        const next: LayoutHost[] = [];
        const blocks = staging.querySelectorAll<HTMLElement>(".block-language-copilot-ui");
        blocks.forEach((block, index) => {
          // Processor-owned sources and native order preserve indentation, nested fences and duplicate layouts. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
          const source = nativeUiSources.get(block)!;
          const receiving =
            streaming &&
            index === blocks.length - 1 &&
            activeSource !== undefined &&
            source.startsWith(activeSource);
          const element = currentHosts.current[index]?.element ?? target.doc.win.createDiv();
          block.replaceWith(element);
          next.push({
            source: receiving ? activeSource : source,
            element,
            streaming,
            closed: !receiving,
          });
        });
        currentHosts.current = next;
        target.replaceChildren(staging);
        setHosts(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logWarn("[LayoutMarkdown] render failed", error);
        target.textContent = text;
        currentHosts.current = EMPTY_HOSTS;
        setHosts(EMPTY_HOSTS);
      })
      .finally(() => {
        settled = true;
        // A discarded render may register children until its promise settles. https://github.com/Brevilabs/obsidian-copilot-private/issues/883
        if (cancelled) owner.unload();
      });
    return () => {
      cancelled = true;
      if (settled) owner.unload();
    };
  }, [app, text, sourcePath, streaming, runDataviewQueries]);
  useEffect(() => {
    if (hosts !== EMPTY_HOSTS) onRendered?.(targetRef.current!);
  }, [hosts, onRendered]);
  return (
    <>
      <div ref={targetRef} className={cn(className, !nested && "markdown-rendered")} />
      {hosts.map(({ source, closed, element, streaming: hostStreaming }, index) =>
        createPortal(
          <UiFence
            source={source}
            sourcePath={sourcePath}
            streaming={hostStreaming}
            closed={closed}
          />,
          element,
          String(index)
        )
      )}
    </>
  );
}
