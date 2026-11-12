import { INTELLIGENT_UI_GUIDANCE } from "@/intelligentUi/guidance";
import { parseIntelligentUi, SUPPORTED_ICONS, UI_SCHEMA } from "@/intelligentUi/parser";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/884";

describe("guidance", () => {
  describe("INTELLIGENT_UI_GUIDANCE", () => {
    it(`states each schema primitive's description and attributes from the schema itself (${ISSUE})`, () => {
      for (const [tag, schema] of Object.entries(UI_SCHEMA)) {
        const line = INTELLIGENT_UI_GUIDANCE.split("\n").find((entry) =>
          entry.startsWith(`- ${tag} `)
        );
        expect(line).toContain(schema.description);
        for (const name of Object.keys(schema.props)) expect(line).toContain(` ${name}="`);
      }
    });

    it(`marks required attributes, lists enumerated values and names item containers (${ISSUE})`, () => {
      expect(INTELLIGENT_UI_GUIDANCE).toContain(
        '- grid columns="1|2|3" (required) (contains elements)'
      );
      expect(INTELLIGENT_UI_GUIDANCE).toContain(
        '- callout tone="note|info|tip|success|warning|danger" title="…"'
      );
      expect(INTELLIGENT_UI_GUIDANCE).toContain("- tabs (contains only tab)");
      expect(INTELLIGENT_UI_GUIDANCE).toContain(
        '- step title="…" icon="icon name" (only inside steps; contains plain text or elements, never both)'
      );
      expect(INTELLIGENT_UI_GUIDANCE).toMatch(/- metric[^\n]*\(self-closing\)/);
    });

    it(`lists every supported icon and ends with an example the parser accepts (${ISSUE})`, () => {
      for (const icon of SUPPORTED_ICONS) expect(INTELLIGENT_UI_GUIDANCE).toContain(icon);
      const example = INTELLIGENT_UI_GUIDANCE.split("```copilot-ui\n")[1].split("\n```")[0];
      expect(parseIntelligentUi(example).status).toBe("complete");
    });
  });
});
