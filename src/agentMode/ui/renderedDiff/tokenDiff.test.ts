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

    it("keeps a custom task status in the prefix so the renderer still sees a task", () => {
      expect(splitStructuralPrefix("- [/] Draft the runbook")).toEqual({
        prefix: "- [/] ",
        content: "Draft the runbook",
      });
    });

    it("keeps a callout declaration and its fold marker in the prefix so its title stays content", () => {
      expect(splitStructuralPrefix("> [!warning]- Rollout risks")).toEqual({
        prefix: "> [!warning]- ",
        content: "Rollout risks",
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

    it("does not read a $$ display-math delimiter as inline math (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      expect(tokenizeInline("$$x$$")).toEqual(["$$x$$"]);
    });

    it("splits CJK text per character because it carries no word spaces", () => {
      expect(tokenizeInline("发布准备")).toEqual(["发", "布", "准", "备"]);
    });

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

    it("returns the line untouched when nothing changed", () => {
      expect(diffInline("The pilot runs.", "The pilot runs.")).toBe("The pilot runs.");
    });

    it("replaces an edited Obsidian comment whole so no marker lands inside the hidden text (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      expect(diffInline("Ship it %%draft note%% today.", "Ship it %%final note%% today.")).toBe(
        `Ship it ${deleted("%%draft note%%")}${inserted("%%final note%%")} today.`
      );
    });

    it("replaces edited inline math whole so no marker lands inside the TeX (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      expect(diffInline("Area is $\\pi r^2$ here.", "Area is $\\pi d^2$ here.")).toBe(
        `Area is ${deleted("$\\pi r^2$")}${inserted("$\\pi d^2$")} here.`
      );
    });

    it("replaces a bare URL whole, leaving emphasis delimiters around it outside the marks https://github.com/Brevilabs/obsidian-copilot-private/issues/349", () => {
      expect(diffInline("see https://ex.com/a_b1 now", "see https://ex.com/a_b2 now")).toBe(
        `see ${deleted("https://ex.com/a_b1")}${inserted("https://ex.com/a_b2")} now`
      );
      expect(diffInline("**https://a.com** now", "**https://b.com** now")).toBe(
        `**${deleted("https://a.com")}${inserted("https://b.com")}** now`
      );
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

    it("shows a mostly reworded line as the whole old line and the whole new line https://github.com/Brevilabs/obsidian-copilot-private/issues/349", () => {
      const before = "Watering should happen in the morning to reduce evaporation.";
      const after = "Water the beds early in the morning so less moisture evaporates.";

      expect(diffTextBlock(before, after)).toBe(`${deleted(before)}\n${inserted(after)}`);
    });

    it("keeps word marks inside a line whose wording mostly survives", () => {
      const merged = diffTextBlock(
        "The pilot runs for six weeks with two design partners.",
        "The pilot runs for eight weeks with three design partners."
      );

      expect(merged).toBe(
        `The pilot runs for ${deleted("six")}${inserted("eight")} weeks with ${deleted("two")}${inserted("three")} design partners.`
      );
    });

    it("marks a removed list item in place so the reader sees where it was", () => {
      const merged = diffTextBlock("- One\n- Two\n- Three", "- One\n- Three");

      expect(merged).toBe(`- One\n- ${deleted("Two")}\n- Three`);
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

    it("marks an item added above an edited item as inserted instead of pairing it with the edit", () => {
      const merged = diffTextBlock("- Banana\n- Cherry", "- Apple\n- Banana bread\n- Cherry");

      expect(merged).toBe(`- ${inserted("Apple")}\n- Banana${inserted(" bread")}\n- Cherry`);
    });

    it("marks a new first line of a paragraph as inserted and diffs the edited line it precedes", () => {
      const merged = diffTextBlock(
        "The pilot runs for six weeks.",
        "Summary first.\nThe pilot runs for ten weeks."
      );

      expect(merged).toBe(
        `${inserted("Summary first.")}\nThe pilot runs for ${deleted("six")}${inserted("ten")} weeks.`
      );
    });

    it.each([
      ["removed", "**bold** stays", "bold stays"],
      ["added", "bold stays", "**bold** stays"],
    ])(
      "emits a line whose emphasis was %s as a removed line and an added line because markers around bare delimiters render nothing (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)",
      (_change, before, after) => {
        expect(diffTextBlock(before, after)).toBe(`${deleted(before)}\n${inserted(after)}`);
      }
    );

    it("emits a toggled custom task status as a removed line and an added line", () => {
      const merged = diffTextBlock("- [ ] Draft the runbook", "- [/] Draft the runbook");

      expect(merged).toBe(
        `- [ ] ${deleted("Draft the runbook")}\n- [/] ${inserted("Draft the runbook")}`
      );
    });

    it("emits a callout whose type changed as a removed line and an added line so the callout still renders", () => {
      const merged = diffTextBlock("> [!note] Risks\n> Body", "> [!warning] Risks\n> Body");

      expect(merged).toBe(
        `> [!note] ${deleted("Risks")}\n> [!warning] ${inserted("Risks")}\n> Body`
      );
    });

    it("keeps renumbered ordered-list items unmarked when only their numbers changed (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", () => {
      const merged = diffTextBlock("1. Draft\n2. Review", "1. Plan\n2. Draft\n3. Review");

      expect(merged).toBe(`1. ${inserted("Plan")}\n2. Draft\n3. Review`);
    });
  });
});
