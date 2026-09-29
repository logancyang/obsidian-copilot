import { OpLog } from "@/agentMode/session/host/OpLog";

const build = (maxOps = 100, maxBytes = 1_000_000) =>
  new OpLog<string>({ epoch: "log-1", maxOps, maxBytes, sizeOf: (op) => op.length });

describe("OpLog", () => {
  describe("append()", () => {
    it("numbers ops from one and returns the new head", () => {
      const log = build();
      expect(log.getHead()).toBe(0);
      expect(log.append("a")).toBe(1);
      expect(log.append("b")).toBe(2);
    });

    it("evicts the oldest ops beyond the op-count bound while the head keeps counting", () => {
      const log = build(3);
      for (const op of ["a", "b", "c", "d", "e"]) log.append(op);
      expect(log.getHead()).toBe(5);
      expect(log.since(2)).toEqual(["c", "d", "e"]);
      expect(log.covers(1)).toBe(false);
    });

    it("evicts the oldest ops beyond the byte budget and can evict everything for one oversized op", () => {
      const log = build(100, 10);
      log.append("aaaa");
      log.append("bbbb");
      log.append("cccc");
      expect(log.since(1)).toEqual(["bbbb", "cccc"]);
      log.append("x".repeat(50));
      expect(log.since(4)).toEqual([]);
      expect(log.covers(3)).toBe(false);
      expect(log.covers(4)).toBe(true);
    });

    it("keeps sequence numbers correct across internal compaction", () => {
      const log = build(2);
      for (let i = 0; i < 2000; i++) log.append(`op${i}`);
      expect(log.getHead()).toBe(2000);
      expect(log.since(1998)).toEqual(["op1998", "op1999"]);
    });
  });

  describe("covers()", () => {
    it("accepts cursors from the oldest retained predecessor up to the head", () => {
      const log = build(2);
      for (const op of ["a", "b", "c"]) log.append(op);
      expect(log.covers(0)).toBe(false);
      expect(log.covers(1)).toBe(true);
      expect(log.covers(3)).toBe(true);
    });

    it("rejects a cursor ahead of the head and non-integer cursors", () => {
      const log = build();
      log.append("a");
      expect(log.covers(2)).toBe(false);
      expect(log.covers(0.5)).toBe(false);
    });
  });

  describe("since()", () => {
    it("returns ops after the cursor and nothing when the cursor is the head", () => {
      const log = build();
      for (const op of ["a", "b", "c"]) log.append(op);
      expect(log.since(1)).toEqual(["b", "c"]);
      expect(log.since(3)).toEqual([]);
    });
  });

  describe("getEpoch()", () => {
    it("returns the id the log was created with so cursors can name it", () => {
      expect(build(10, 100).getEpoch()).toBe("log-1");
    });
  });
});
