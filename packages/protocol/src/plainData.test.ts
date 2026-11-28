import type { HostFrame } from "@copilot/protocol/frames";
import { findNonPlainField } from "@copilot/protocol/plainData";
import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { SessionOp, SessionState } from "@copilot/protocol/session";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

class VaultFile {
  constructor(
    readonly path: string,
    readonly basename: string
  ) {}
}

const CLAUDE_USAGE: SessionUsage = {
  usedTokens: 52_500,
  contextWindow: 1_000_000,
  inputTokens: 40_000,
  outputTokens: 8_000,
  cacheReadTokens: 4_000,
  cacheWriteTokens: 500,
  updatedAt: 1_764_000_000_000,
};
const COUNT_ONLY_USAGE: SessionUsage = { usedTokens: 27_514, updatedAt: 1_764_000_000_000 };
const WINDOW_DROPPED_USAGE: SessionUsage = {
  ...CLAUDE_USAGE,
  contextWindow: undefined,
};
const PLAN_USAGE: PlanUsage = {
  windows: [
    { id: "five_hour", label: "5h", percent: 8, resetsAt: 1_764_003_600_000 },
    { id: "model_scoped:Fable", label: "Weekly (Fable)", percent: 4 },
    { id: "seven_day", label: "Weekly", percent: 137, resetsAt: 1_764_300_000_000 },
  ],
  updatedAt: 1_764_000_000_000,
};

const STATES: [string, SessionState][] = [
  ["an empty chat", { usage: null, planUsage: null }],
  ["a chat with full usage and plan windows", { usage: CLAUDE_USAGE, planUsage: PLAN_USAGE }],
  ["a chat with a count but no context window", { usage: COUNT_ONLY_USAGE, planUsage: null }],
];
const OPS: [string, SessionOp][] = [
  ["a usage op", { type: "slice", key: "usage", value: CLAUDE_USAGE }],
  ["a usage op that clears usage", { type: "slice", key: "usage", value: null }],
  ["a plan usage op", { type: "slice", key: "planUsage", value: PLAN_USAGE }],
  ["a plan usage op that clears plan usage", { type: "slice", key: "planUsage", value: null }],
];

describe("plainData", () => {
  describe("findNonPlainField()", () => {
    it.each(STATES)("accepts the state of %s, which survives JSON unchanged", (_label, state) => {
      expect(findNonPlainField(state)).toBeNull();
      expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
    });

    it.each(OPS)("accepts %s, which survives JSON unchanged", (_label, op) => {
      expect(findNonPlainField(op)).toBeNull();
      expect(JSON.parse(JSON.stringify(op))).toStrictEqual(op);
    });

    it("accepts every frame the host sends for a chat's usage", () => {
      const frames: HostFrame[] = [
        { type: "hello", version: 1, accepted: true },
        { type: "snapshot", scope: "chat-1", seq: 4, state: STATES[1][1] },
        { type: "ops", scope: "chat-1", from: 5, ops: OPS.map(([, op]) => op) },
      ];

      expect(frames.map(findNonPlainField)).toEqual([null, null, null]);
    });

    it("accepts an optional field set to undefined, since it reads the same as a missing field after JSON", () => {
      const state: SessionState = { usage: WINDOW_DROPPED_USAGE, planUsage: null };

      expect(findNonPlainField(state)).toBeNull();
      expect(JSON.parse(JSON.stringify(state)).usage.contextWindow).toBeUndefined();
    });

    it.each([
      ["an Error", new Error("boom"), "Error"],
      ["a function", () => 1, "function"],
      ["a Map", new Map([["a", 1]]), "Map"],
      ["a Set", new Set([1]), "Set"],
      ["a Date", new Date(0), "Date"],
      ["a class instance", new VaultFile("Notes/a.md", "a"), "VaultFile"],
      ["NaN", Number.NaN, "NaN"],
      ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
      ["a bigint", BigInt(1), "bigint"],
      ["a symbol", Symbol("s"), "symbol"],
    ])("names the path of %s nested in an op", (_label, bad, found) => {
      const op = { type: "slice", key: "usage", value: { ...CLAUDE_USAGE, extra: bad } };

      expect(findNonPlainField({ ops: [op] })).toEqual({ path: "ops[0].value.extra", found });
    });

    it("names a note file object carried where a chat would carry a note path", () => {
      const frame = { context: { notes: [{ path: "a.md" }, new VaultFile("b.md", "b")] } };

      expect(findNonPlainField(frame)).toEqual({ path: "context.notes[1]", found: "VaultFile" });
    });

    it("names undefined in an array, which JSON turns into null", () => {
      expect(findNonPlainField({ windows: [1, undefined] })).toEqual({
        path: "windows[1]",
        found: "undefined",
      });
    });

    it("names a value that refers back to an object containing it", () => {
      const parent: Record<string, unknown> = { name: "folder" };
      parent.children = [{ parent }];

      expect(findNonPlainField(parent)).toEqual({
        path: "children[0].parent",
        found: "circular reference",
      });
    });

    it("accepts the same object reached by two paths, which JSON copies into both", () => {
      const shared = { id: "weekly" };

      expect(findNonPlainField({ a: shared, b: [shared] })).toBeNull();
    });

    it("names the value itself with an empty path when the top level is not plain", () => {
      expect(findNonPlainField(undefined)).toEqual({ path: "", found: "undefined" });
      expect(findNonPlainField(new Map())).toEqual({ path: "", found: "Map" });
    });

    it("accepts an object with no prototype", () => {
      const bare = Object.assign(Object.create(null) as object, { usedTokens: 1 });

      expect(findNonPlainField(bare)).toBeNull();
    });
  });
});
