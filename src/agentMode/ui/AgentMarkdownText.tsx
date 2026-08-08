import React, { useEffect, useRef } from "react";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { App, Component } from "obsidian";

interface AgentMarkdownTextProps {
  text: string;
  app: App;
}

/**
 * Render a string as Obsidian markdown. Mirrors the
 * `MarkdownRenderer.render` lifecycle pattern used by `PlanPreviewView` —
 * the component reloads on each text change so growing chunks restream
 * cleanly without leaking listeners.
 */
export const AgentMarkdownText: React.FC<AgentMarkdownTextProps> = ({ text, app }) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    target.classList.add("markdown-rendered");
    target.empty();
    const component = new Component();
    component.load();
    // Resolve internal links against the active note so vaults with
    // duplicate basenames or heading-only links open the right file.
    const sourcePath = app.workspace.getActiveFile()?.path ?? "";
    renderMarkdown(app, text, target, sourcePath, component).catch((e: unknown) => {
      logWarn("[AgentTrail] markdown render failed", e);
    });
    return () => {
      component.unload();
      target.empty();
    };
  }, [app, text]);

  return <div ref={targetRef} className="tw-p-1 tw-text-sm" />;
};
