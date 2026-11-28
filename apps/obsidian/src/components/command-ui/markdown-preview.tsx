import * as React from "react";

interface MarkdownPreviewProps {
  content: string;
  renderMarkdown: (content: string, el: HTMLElement) => Promise<void>;
  className?: string;
}

export function MarkdownPreview({ content, renderMarkdown, className }: MarkdownPreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const renderGenRef = React.useRef(0);

  React.useEffect(() => {
    const targetEl = ref.current;
    if (!targetEl) return;

    const currentGen = ++renderGenRef.current;
    const scratchEl = targetEl.doc.win.createDiv();

    targetEl.replaceChildren();
    renderMarkdown(content, scratchEl)
      .then(() => {
        if (currentGen !== renderGenRef.current) return;
        targetEl.replaceChildren(...Array.from(scratchEl.childNodes));
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
