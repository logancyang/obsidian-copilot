import { Change, diffTrimmedLines } from "diff";

import { getChangeBlocks } from "@/composerUtils";

describe("composerUtils", () => {
  describe("getChangeBlocks()", () => {
    function change(value: string, flags?: { added?: boolean; removed?: boolean }): Change {
      return {
        value,
        count: 1,
        added: flags?.added ?? false,
        removed: flags?.removed ?? false,
      };
    }

    it("groups consecutive added and removed changes into a single block", () => {
      const changes = [
        change("keep\n"),
        change("old\n", { removed: true }),
        change("new\n", { added: true }),
        change("tail\n"),
      ];

      expect(getChangeBlocks(changes)).toEqual([
        [changes[0]],
        [changes[1], changes[2]],
        [changes[3]],
      ]);
    });

    it("puts each unchanged change into its own block", () => {
      const changes = [change("a\n"), change("b\n")];

      expect(getChangeBlocks(changes)).toEqual([[changes[0]], [changes[1]]]);
    });

    it("flushes a trailing changed block", () => {
      const changes = [change("keep\n"), change("added\n", { added: true })];

      expect(getChangeBlocks(changes)).toEqual([[changes[0]], [changes[1]]]);
    });

    it("returns no blocks for an empty change list", () => {
      expect(getChangeBlocks([])).toEqual([]);
    });

    it("blocks real diffTrimmedLines output the way the composer preview consumes it", () => {
      const changes = diffTrimmedLines("keep\nold\ntail\n", "keep\nnew\ntail\n", {
        newlineIsToken: true,
      });
      const blocks = getChangeBlocks(changes);

      const flags = blocks.map((block) =>
        block.map((c) => ({ value: c.value, added: c.added, removed: c.removed }))
      );
      expect(flags).toEqual([
        [{ value: "keep\n", added: false, removed: false }],
        [
          { value: "old", added: false, removed: true },
          { value: "new", added: true, removed: false },
        ],
        [{ value: "\ntail\n", added: false, removed: false }],
      ]);
    });
  });
});
