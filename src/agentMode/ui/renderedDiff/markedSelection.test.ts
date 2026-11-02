import { markedSelectionText } from "@/agentMode/ui/renderedDiff/markedSelection";

const ISSUE_824 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/824";

function rendered(html: string): HTMLElement {
  const root = document.createElement("div");
  root.append(...Array.from(new DOMParser().parseFromString(html, "text/html").body.childNodes));
  document.body.append(root);
  return root;
}

function rangeOver(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  return range;
}

function wholeOf(root: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range;
}

function textIn(root: HTMLElement, selector: string): Text {
  return root.querySelector(selector)!.firstChild as Text;
}

describe("markedSelection", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  describe("markedSelectionText()", () => {
    it(`marks removed words with <del> and added words with <ins> between unchanged text (${ISSUE_824})`, () => {
      const root = rendered(
        '<p>The <del data-change="deleted">quick</del><ins data-change="inserted">slow</ins> fox.</p>'
      );

      expect(markedSelectionText(wholeOf(root))).toBe("The <del>quick</del><ins>slow</ins> fox.");
    });

    it(`returns unchanged text as it reads when the selection holds no change (${ISSUE_824})`, () => {
      const root = rendered("<p>Nothing changed here.</p>");

      expect(markedSelectionText(wholeOf(root))).toBe("Nothing changed here.");
    });

    it(`marks only the selected part of a change the selection starts or ends inside (${ISSUE_824})`, () => {
      const root = rendered(
        '<p>The <del data-change="deleted">quick</del><ins data-change="inserted">slow</ins> fox.</p>'
      );
      const fox = root.querySelector("p")!.lastChild!;

      const range = rangeOver(textIn(root, "del"), 2, fox, 3);

      expect(markedSelectionText(range)).toBe("<del>ick</del><ins>slow</ins> fo");
    });

    it(`marks text selected wholly inside one change by that change's kind (${ISSUE_824})`, () => {
      const root = rendered('<p>The <ins data-change="inserted">slow</ins> fox.</p>');

      const range = rangeOver(textIn(root, "ins"), 1, textIn(root, "ins"), 3);

      expect(markedSelectionText(range)).toBe("<ins>lo</ins>");
    });

    it(`marks a removed block once rather than again for each word inside it (${ISSUE_824})`, () => {
      const root = rendered(
        '<div data-change="deleted"><p>Old <span data-change="deleted">paragraph</span></p></div><p>Kept</p>'
      );

      expect(markedSelectionText(wholeOf(root))).toBe("<del>Old paragraph</del>\nKept");
    });

    it(`puts each paragraph, list item, code line and table row on its own line with cells tab-separated (${ISSUE_824})`, () => {
      const root = rendered(
        [
          "<h2>Plan</h2>",
          "<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
          '<pre><div data-change="deleted">  old()</div><div data-change="inserted">  new()</div></pre>',
          "<table>\n<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n",
          '<tr data-change="inserted">\n<td><ins data-change="inserted">a</ins></td>\n<td><ins data-change="inserted">b</ins></td>\n</tr>\n</tbody>\n</table>',
        ].join("\n")
      );

      expect(markedSelectionText(wholeOf(root))).toBe(
        "Plan\none\ntwo\n  <del>old()</del>\n  <ins>new()</ins>\n1\t2\n<ins>a\tb</ins>"
      );
    });

    it(`keeps the line breaks and indentation between the highlighted tokens of a code block (${ISSUE_824})`, () => {
      const root = rendered(
        '<pre><code><span class="token keyword">if</span> <span class="token punctuation">(</span>ok<span class="token punctuation">)</span>\n  <span class="token keyword">return</span><span class="token punctuation">;</span>\n</code></pre>'
      );

      expect(markedSelectionText(wholeOf(root))).toBe("if (ok)\n  return;");
    });

    it(`joins neighbouring marks of one kind that only spaces separate, such as a changed link and its sentence (${ISSUE_824})`, () => {
      const root = rendered(
        '<p><del data-change="deleted">See </del><a><del data-change="deleted">fox</del></a><del data-change="deleted"> here.</del></p>'
      );

      expect(markedSelectionText(wholeOf(root))).toBe("<del>See fox here.</del>");
    });

    it(`leaves out the labels of buttons inside the diff, such as a run's Revoke (${ISSUE_824})`, () => {
      const root = rendered(
        '<div><p>The <ins data-change="inserted">slow</ins> fox.</p><button>Revoke</button></div><p>Next.</p>'
      );

      expect(markedSelectionText(wholeOf(root))).toBe("The <ins>slow</ins> fox.\nNext.");
    });

    it(`keeps spaces outside the marks and drops a mark around nothing but an image (${ISSUE_824})`, () => {
      const root = rendered(
        '<p>A <del data-change="deleted">quick </del><span data-change="inserted"><img alt="fox"></span>fox</p>'
      );

      expect(markedSelectionText(wholeOf(root))).toBe("A <del>quick</del> fox");
    });
  });
});
