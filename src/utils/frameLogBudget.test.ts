import { byteLength } from "@/utils/logTail";
import { fitConversationFrames } from "./frameLogBudget";

describe("frameLogBudget", () => {
  describe("fitConversationFrames()", () => {
    it("returns an already-fitting raw log unchanged", () => {
      const text = '{"method":"ready"}\n';
      expect(fitConversationFrames(text, byteLength(text))).toBe(text);
    });

    it("keeps complete opening and newest CJK frames around an omission marker", () => {
      const frames = [
        JSON.stringify({ method: "first", text: "始".repeat(20) }) + "\n",
        JSON.stringify({ method: "middle", text: "frameSink.state" + "中".repeat(500) }) + "\n",
        JSON.stringify({ method: "last", text: "終".repeat(20) }) + "\n",
      ];
      const output = fitConversationFrames(frames.join(""), 300);
      expect(byteLength(output)).toBeLessThanOrEqual(300);
      expect(output).toContain('"method":"first"');
      expect(output).toContain('"method":"last"');
      expect(output).toContain('{"frameSink":"elided"}');
      expect(output).not.toContain("frameSink.state");
      expect(output).not.toContain("�");
      for (const line of output
        .split("\n")
        .filter((line) => line && !line.includes('"frameSink":"elided"'))) {
        expect(() => {
          JSON.parse(line);
        }).not.toThrow();
      }
    });

    it("budgets every conversation header and fails when all section markers cannot fit (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", () => {
      const a =
        '{"frameSink":"conversation","file":"a.ndjson"}\n' +
        '{"method":"a1"}\n' +
        '{"method":"a2"}\n';
      const b =
        '{"frameSink":"conversation","file":"b.ndjson"}\n' +
        '{"method":"b1"}\n' +
        '{"method":"b2"}\n';
      const output = fitConversationFrames(a + b, 180);
      expect(byteLength(output)).toBeLessThanOrEqual(180);
      expect(output.match(/"frameSink":"conversation"/g)).toHaveLength(2);
      expect(output).toContain('"method":"a1"');
      expect(output).toContain('"method":"b2"');
      expect(() => fitConversationFrames(a + b, 40)).toThrow(
        "Frame-log budget cannot hold every section header and omission marker"
      );
    });
  });
});
