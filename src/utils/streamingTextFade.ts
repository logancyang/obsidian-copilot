export const TEXT_FADE_MS = 400;
const UNTOUCHED = "pre, code, svg, .math, mjx-container, [data-ui-host]";

interface FadeRange {
  start: number;
  end: number;
  at: number;
}

function fadeableTextNodes(container: HTMLElement): Text[] {
  const walker = container.doc.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.TEXT_NODE
          ? NodeFilter.FILTER_ACCEPT
          : (node as Element).matches(UNTOUCHED)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP,
    }
  );
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

// Chat re-renders a streaming reply's whole Markdown on every update, so newly added text is wrapped and faded after each render, resuming fades that a re-render recreated. https://github.com/Brevilabs/obsidian-copilot-private/issues/886
export class StreamingTextFade {
  private seen = 0;
  private ranges: FadeRange[] = [];

  apply(container: HTMLElement): void {
    const now = performance.now();
    const nodes = fadeableTextNodes(container);
    const total = nodes.reduce((length, node) => length + node.data.length, 0);
    if (total > this.seen) this.ranges.push({ start: this.seen, end: total, at: now });
    this.seen = total;
    this.ranges = this.ranges.filter(
      (range) => now - range.at < TEXT_FADE_MS && range.start < total
    );
    if (!this.ranges.length || container.win.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    let offset = 0;
    for (const node of nodes) {
      const start = offset;
      const end = offset + node.data.length;
      offset = end;
      const hits = this.ranges.filter((range) => range.start < end && range.end > start);
      if (!hits.length) continue;
      const fragment = createFragment();
      const fading: [HTMLSpanElement, FadeRange][] = [];
      let cursor = start;
      for (const range of hits) {
        const from = Math.max(range.start, start);
        if (from > cursor) fragment.append(node.data.slice(cursor - start, from - start));
        const to = Math.min(range.end, end);
        fading.push([
          fragment.createSpan({ text: node.data.slice(from - start, to - start) }),
          range,
        ]);
        cursor = to;
      }
      if (cursor < end) fragment.append(node.data.slice(cursor - start));
      node.replaceWith(fragment);
      for (const [span, range] of fading)
        span.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: TEXT_FADE_MS,
          easing: "ease-out",
        }).currentTime = now - range.at;
    }
  }
}
