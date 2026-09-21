import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import {
  diffInline,
  diffTextBlock,
  markDeletedLine,
  markInsertedLine,
  splitStructuralPrefix,
  tokenizeInline,
} from "@/agentMode/ui/renderedDiff/tokenDiff";

const deleted = (text: string): string => DEL_OPEN + text + DEL_CLOSE;
const inserted = (text: string): string => INS_OPEN + text + INS_CLOSE;

const atomicEdits = [
  [
    "nested link destinations",
    "[doc](https://example.com/a(b)c)",
    "[doc](https://example.com/a(b)d)",
  ],
  [
    "deeply nested image destinations",
    "![chart](a(b(c(d(e)f)g)h)i)",
    "![chart](a(b(c(d(e)f)g)h)j)",
  ],
  ["escaped closing parentheses", "[doc](a\\)b)", "[doc](a\\)c)"],
  ["escaped opening parentheses", "[doc](a\\(b)", "[doc](a\\(c)"],
  ["escaped backslashes before parentheses", "[doc](a\\\\(b)c)", "[doc](a\\\\(b)d)"],
  ["longer internal backtick runs", "`alpha `` beta`", "`alpha `` gamma`"],
  ["multi-backtick delimiters", "``alpha ``` beta``", "``alpha ``` gamma``"],
  ["shorter internal backtick runs", "````alpha ``` beta````", "````alpha ``` gamma````"],
] as const;

describe("tokenDiff", () => {
  describe("splitStructuralPrefix()", () => {
    it("keeps a list bullet out of the diffable content", () => {
      expect(splitStructuralPrefix("- Who owns the runbook?")).toEqual({
        prefix: "- ",
        content: "Who owns the runbook?",
      });
    });

    it("keeps a task checkbox with its bullet in the prefix so the renderer still sees a task", () => {
      expect(splitStructuralPrefix("- [x] Draft the runbook")).toEqual({
        prefix: "- [x] ",
        content: "Draft the runbook",
      });
    });

    it("keeps heading hashes and quote markers in the prefix", () => {
      expect(splitStructuralPrefix("> ### Rollout plan")).toEqual({
        prefix: "> ### ",
        content: "Rollout plan",
      });
    });

    it("treats a tag at the start of a paragraph as content, not as heading syntax", () => {
      expect(splitStructuralPrefix("#rollout is the tag")).toEqual({
        prefix: "",
        content: "#rollout is the tag",
      });
    });
  });

  describe("tokenizeInline()", () => {
    it("keeps a Markdown link whole so no marker can land inside its URL", () => {
      expect(tokenizeInline("See [the checklist](https://example.com/a b).")).toContain(
        "[the checklist](https://example.com/a b)"
      );
    });

    it("keeps a wikilink, an embed and inline code whole", () => {
      expect(tokenizeInline("[[Runbook]] ![[Chart.png]] `npm run verify`")).toEqual([
        "[[Runbook]]",
        " ",
        "![[Chart.png]]",
        " ",
        "`npm run verify`",
      ]);
    });

    it("treats an emphasis delimiter run as its own token", () => {
      expect(tokenizeInline("**bold**")).toEqual(["**", "bold", "**"]);
    });

    it("splits CJK text per character because it carries no word spaces", () => {
      expect(tokenizeInline("发布准备")).toEqual(["发", "布", "准", "备"]);
    });

    it.each(atomicEdits)(
      "keeps %s atomic so diff markers cannot split syntax (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)",
      (_name, before, after) => {
        expect(tokenizeInline(`See ${before} first.`)).toEqual(["See", " ", before, " ", "first."]);
        expect(tokenizeInline(`See ${after} first.`)).toEqual(["See", " ", after, " ", "first."]);
      }
    );

    it.each(["``", "```", "````"])(
      "does not shorten an unmatched %s opener to manufacture a code span (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)",
      (opening) => {
        expect(tokenizeInline(`${opening}alpha \` beta`)).toEqual([
          `${opening}alpha`,
          " ",
          "`",
          " ",
          "beta",
        ]);
      }
    );
  });

  describe("diffInline()", () => {
    it("marks only the words that changed and leaves the rest of the line alone", () => {
      const merged = diffInline("The pilot runs for six weeks.", "The pilot runs for eight weeks.");

      expect(merged).toBe(`The pilot runs for ${deleted("six")}${inserted("eight")} weeks.`);
    });

    it("replaces a link as a whole when only its URL changed", () => {
      const merged = diffInline(
        "See the [checklist](https://example.com/v1) first.",
        "See the [checklist](https://example.com/v2) first."
      );

      expect(merged).toBe(
        `See the ${deleted("[checklist](https://example.com/v1)")}${inserted(
          "[checklist](https://example.com/v2)"
        )} first.`
      );
    });

    it("merges two change runs separated by at most three unchanged characters into one replacement", () => {
      const merged = diffInline("alpha, beta", "gamma, delta");

      expect(merged).toBe(`${deleted("alpha, beta")}${inserted("gamma, delta")}`);
    });

    it("keeps change runs apart when more than three unchanged characters sit between them", () => {
      const merged = diffInline("alpha until beta", "gamma until delta");

      expect(merged).toBe(
        `${deleted("alpha")}${inserted("gamma")} until ${deleted("beta")}${inserted("delta")}`
      );
    });

    it("returns the line untouched when nothing changed", () => {
      expect(diffInline("The pilot runs.", "The pilot runs.")).toBe("The pilot runs.");
    });

    it.each(atomicEdits)(
      "replaces %s whole without inserting markers inside syntax (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)",
      (_name, before, after) => {
        expect(diffInline(`See ${before} first.`, `See ${after} first.`)).toBe(
          `See ${deleted(before)}${inserted(after)} first.`
        );
      }
    );
  });

  describe("markDeletedLine()", () => {
    it("marks the content of a list item while leaving its bullet renderable", () => {
      expect(markDeletedLine("- Do we still need the staging vault?")).toBe(
        `- ${deleted("Do we still need the staging vault?")}`
      );
    });

    it("leaves a line with no content untouched so no empty marker reaches the renderer", () => {
      expect(markDeletedLine("- ")).toBe("- ");
    });
  });

  describe("markInsertedLine()", () => {
    it("marks the content of a heading while leaving its hashes renderable", () => {
      expect(markInsertedLine("## Rollout plan")).toBe(`## ${inserted("Rollout plan")}`);
    });
  });

  describe("diffTextBlock()", () => {
    it("marks an added list item without disturbing the items around it", () => {
      const merged = diffTextBlock("- One\n- Two", "- One\n- Two\n- Three");

      expect(merged).toBe(`- One\n- Two\n- ${inserted("Three")}`);
    });

    it("marks a removed list item in place so the reader sees where it was", () => {
      const merged = diffTextBlock("- One\n- Two\n- Three", "- One\n- Three");

      expect(merged).toBe(`- One\n- ${deleted("Two")}\n- Three`);
    });

    it("diffs paired lines at token level rather than replacing them whole", () => {
      const merged = diffTextBlock(
        "The pilot runs for six weeks.",
        "The pilot runs for ten weeks."
      );

      expect(merged).toBe(`The pilot runs for ${deleted("six")}${inserted("ten")} weeks.`);
    });

    it("emits a toggled task as a removed line and an added line because the change is in the checkbox syntax", () => {
      const merged = diffTextBlock("- [ ] Draft the runbook", "- [x] Draft the runbook");

      expect(merged).toBe(
        `- [ ] ${deleted("Draft the runbook")}\n- [x] ${inserted("Draft the runbook")}`
      );
    });

    it("emits a re-levelled heading as a removed line and an added line so both render as headings", () => {
      const merged = diffTextBlock("## Rollout plan", "### Rollout plan");

      expect(merged).toBe(`## ${deleted("Rollout plan")}\n### ${inserted("Rollout plan")}`);
    });
  });
});
