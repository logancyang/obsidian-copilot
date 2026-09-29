import { estimateOpBytes } from "@/agentMode/session/host/opSize";

describe("opSize", () => {
  describe("estimateOpBytes()", () => {
    it("scales streamed text ops with their text length without serializing them", () => {
      const spy = jest.spyOn(JSON, "stringify");
      const small = estimateOpBytes({ t: "msg.appendText", id: "m", text: "hi", atMs: 1 });
      const large = estimateOpBytes({
        t: "msg.appendThought",
        id: "m",
        text: "x".repeat(1000),
        atMs: 1,
      });
      expect(large - small).toBe(998);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("counts tool output text and diffs for part upserts", () => {
      const base = { t: "msg.upsertPart", id: "m", atMs: 1 } as const;
      const bare = estimateOpBytes({
        ...base,
        part: { kind: "tool_call", id: "t", title: "Read", status: "pending" },
      });
      const withOutput = estimateOpBytes({
        ...base,
        part: {
          kind: "tool_call",
          id: "t",
          title: "Read",
          status: "completed",
          input: { path: "a" },
          output: [
            { type: "text", text: "y".repeat(100) },
            { type: "diff", path: "a", oldText: "o".repeat(10), newText: "n".repeat(20) },
          ],
        },
      });
      expect(withOutput - bare).toBe(100 + 30 + 512);
    });

    it("estimates plan, text and thought parts from their text", () => {
      const base = { t: "msg.upsertPart", id: "m", atMs: 1 } as const;
      expect(estimateOpBytes({ ...base, part: { kind: "text", text: "abc" } })).toBe(67);
      expect(estimateOpBytes({ ...base, part: { kind: "thought", text: "abcd" } })).toBe(68);
      expect(
        estimateOpBytes({
          ...base,
          part: {
            kind: "plan",
            entries: [{ content: "step", priority: "high", status: "pending" }],
          },
        })
      ).toBe(64 + 4 + 48);
    });

    it("serializes every other op", () => {
      const op = { t: "tab.remove", id: "s1" } as const;
      expect(estimateOpBytes(op)).toBe(JSON.stringify(op).length);
    });
  });
});
