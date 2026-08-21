import { visit } from "unist-util-visit";

/** A link to a sibling guide, such as `getting-started.md`, `./x.md`, or `x.md#anchor`. */
const SIBLING_GUIDE_LINK = /^(?:\.\/)?([^/#?]+)\.md(#.+)?$/;

/**
 * Adapts the Markdown in `docs/` to the routes this site publishes. The guides
 * are written to be read in place, so they link to each other by filename;
 * those links are rewritten to Starlight routes, keeping any anchor and leaving
 * absolute URLs alone. The opening level-one heading is also removed, because
 * `headingTitledGlob` has already promoted it to the page title.
 */
export function remarkPublishedDocs() {
  return (tree) => {
    // These branches preserve source-guide structure and links during publishing.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/301
    const [opening] = tree.children;
    if (opening?.type === "heading" && opening.depth === 1) {
      tree.children.shift();
    }
    visit(tree, "link", (node) => {
      const match = SIBLING_GUIDE_LINK.exec(node.url);
      if (!match) return;
      const [, name, anchor = ""] = match;
      node.url = `${name === "index" ? "/" : `/${name}/`}${anchor}`;
    });
  };
}
