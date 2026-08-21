import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { remarkPublishedDocs } from "./remark-published-docs.mjs";

function transform(children) {
  const tree = { type: "root", children };
  remarkPublishedDocs()(tree);
  return tree;
}

describe("remark-published-docs", () => {
  describe("remarkPublishedDocs()", () => {
    it("removes only an opening level-one heading (https://github.com/Brevilabs/obsidian-copilot-private/issues/301)", () => {
      const openingHeading = { type: "heading", depth: 1, children: [] };
      const laterHeading = { type: "heading", depth: 1, children: [] };
      const paragraph = { type: "paragraph", children: [] };

      assert.deepEqual(transform([openingHeading, paragraph, laterHeading]).children, [
        paragraph,
        laterHeading,
      ]);
      assert.deepEqual(transform([paragraph, laterHeading]).children, [paragraph, laterHeading]);
    });

    it("rewrites sibling guide links and leaves other links unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/301)", () => {
      const links = [
        { type: "link", url: "index.md", children: [] },
        { type: "link", url: "getting-started.md#first-chat", children: [] },
        { type: "link", url: "./settings.md", children: [] },
        { type: "link", url: "plans/internal.md", children: [] },
        { type: "link", url: "https://www.miyo.md/", children: [] },
      ];

      transform([{ type: "paragraph", children: links }]);

      assert.deepEqual(
        links.map(({ url }) => url),
        [
          "/",
          "/getting-started/#first-chat",
          "/settings/",
          "plans/internal.md",
          "https://www.miyo.md/",
        ]
      );
    });
  });
});
