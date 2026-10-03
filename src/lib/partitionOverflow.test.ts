import { partitionOverflow } from "@/lib/partitionOverflow";

const item = (id: string) => ({ id });
const keyOf = (x: { id: string }) => x.id;
const ids = (xs: { id: string }[]) => xs.map(keyOf);

describe("partitionOverflow", () => {
  describe("partitionOverflow()", () => {
    it("splits front-to-back when the active item is already inline", () => {
      const { visible, overflow } = partitionOverflow(
        [item("a"), item("b"), item("c"), item("d")],
        2,
        "a",
        keyOf
      );
      expect(ids(visible)).toEqual(["a", "b"]);
      expect(ids(overflow)).toEqual(["c", "d"]);
    });

    it("pins the active item into the last inline slot when it would overflow", () => {
      const { visible, overflow } = partitionOverflow(
        [item("a"), item("b"), item("c"), item("d")],
        2,
        "d",
        keyOf
      );
      expect(ids(visible)).toEqual(["a", "d"]);
      expect(ids(overflow)).toEqual(["b", "c"]);
    });

    it("returns empty arrays for empty input", () => {
      expect(partitionOverflow([], 0, null, keyOf)).toEqual({ visible: [], overflow: [] });
    });

    it("does not swap when no item is active", () => {
      const { visible, overflow } = partitionOverflow(
        [item("a"), item("b"), item("c")],
        1,
        null,
        keyOf
      );
      expect(ids(visible)).toEqual(["a"]);
      expect(ids(overflow)).toEqual(["b", "c"]);
    });

    it("keeps an overflowing active item in sight with a single inline slot", () => {
      const { visible, overflow } = partitionOverflow(
        [item("a"), item("b"), item("c")],
        1,
        "c",
        keyOf
      );
      expect(ids(visible)).toEqual(["c"]);
      expect(ids(overflow)).toEqual(["a", "b"]);
    });

    it("shows nothing inline, and swaps nothing, when no slot is left", () => {
      const { visible, overflow } = partitionOverflow([item("a"), item("b")], 0, "b", keyOf);
      expect(ids(visible)).toEqual([]);
      expect(ids(overflow)).toEqual(["a", "b"]);
    });
  });
});
