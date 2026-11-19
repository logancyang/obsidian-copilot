import { PILL_BADGE_CLASS } from "@/components/chat-components/pills/PillBadge";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const MENTION_PILL_CLASS = cn(badgeVariants({ variant: "secondary" }), PILL_BADGE_CLASS);

export function renderMentionPills(
  container: HTMLElement,
  mentions: readonly string[],
  createPill: (doc: Document, mention: string) => Node
): void {
  if (mentions.length === 0) return;
  const doc = container.doc;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest("code, pre")) textNodes.push(node as Text);
  }
  for (const node of textNodes) {
    let rest = node.textContent ?? "";
    const fragment = doc.win.createFragment();
    for (;;) {
      const next = mentions
        .map((mention) => ({ mention, index: rest.indexOf(mention) }))
        .filter(({ index }) => index !== -1)
        .sort((a, b) => a.index - b.index || b.mention.length - a.mention.length)[0];
      if (!next) break;
      fragment.append(rest.slice(0, next.index));
      fragment.appendChild(createPill(doc, next.mention));
      rest = rest.slice(next.index + next.mention.length);
    }
    if (fragment.childNodes.length === 0) continue;
    fragment.append(rest);
    node.replaceWith(fragment);
  }
}

// The Markdown renderer leaves a folder mention as plain `{path}` text, and a mentioned folder gets no badge, so the sent message styles it as a pill.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/932
export function renderFolderMentions(container: HTMLElement, folders: readonly string[]): void {
  renderMentionPills(
    container,
    folders.map((folder) => `{${folder}}`),
    (doc, mention) => doc.win.createSpan({ cls: MENTION_PILL_CLASS, text: mention })
  );
}
