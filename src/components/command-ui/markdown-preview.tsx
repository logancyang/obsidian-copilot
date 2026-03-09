import * as React from "react";

interface MarkdownPreviewProps {
  content: string;
  renderMarkdown: (content: string, el: HTMLElement) => Promise<void>;
  className?: string;
}

/**
 * Renders markdown content into a div using a provided renderMarkdown callback.
 * Includes async race protection — only the latest render call takes effect.
 *
 * Reason: Keeps consuming components Obsidian-agnostic while supporting
 * rich markdown rendering via MarkdownRenderer injected from the parent.
 */
export function MarkdownPreview({ content, renderMarkdown, className }: MarkdownPreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const renderGenRef = React.useRef(0);

  React.useEffect(() => {
    const targetEl = ref.current;
    if (!targetEl) return;

    const currentGen = ++renderGenRef.current;
    // Reason: Render into a detached element so that if content changes
    // mid-render, the stale result never touches the live DOM.
    // Reason: Use ownerDocument for popout-window safety in Obsidian
    const scratchEl = targetEl.ownerDocument.createElement("div");

    targetEl.innerHTML = "";
    renderMarkdown(content, scratchEl)
      .then(() => {
        if (currentGen !== renderGenRef.current) return;
        targetEl.replaceChildren(...Array.from(scratchEl.childNodes));
        // Propagate the markdown-rendered class that MarkdownRenderer adds
        if (scratchEl.classList.contains("markdown-rendered")) {
          targetEl.classList.add("markdown-rendered");
        }
      })
      .catch(() => {
        if (currentGen !== renderGenRef.current) return;
        targetEl.textContent = content;
      });
  }, [content, renderMarkdown]);

  return <div ref={ref} className={className} />;
}
