import { buildTurnFileChange } from "@/agentMode/session/turnFileChanges";

describe("turnFileChanges", () => {
  describe("buildTurnFileChange()", () => {
    it("counts the added and removed lines of an edited file", () => {
      expect(
        buildTurnFileChange("notes/a.md", "one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n")
      ).toEqual({
        path: "notes/a.md",
        status: "modified",
        before: "one\ntwo\nthree\n",
        after: "one\nTWO\nthree\nfour\n",
        additions: 2,
        deletions: 1,
      });
    });

    it("reports a file that did not exist before the turn as created", () => {
      const change = buildTurnFileChange("notes/new.md", null, "fresh\nnote\n");
      expect(change).toMatchObject({
        status: "created",
        before: null,
        additions: 2,
        deletions: 0,
      });
    });

    it("reports a file the turn removed as deleted", () => {
      const change = buildTurnFileChange("notes/gone.md", "one\ntwo\n", null);
      expect(change).toMatchObject({
        status: "deleted",
        after: null,
        additions: 0,
        deletions: 2,
      });
    });

    it("returns null when the turn left the file byte-identical", () => {
      expect(buildTurnFileChange("notes/a.md", "same\n", "same\n")).toBeNull();
    });

    it("returns null for a file that never existed on either side", () => {
      expect(buildTurnFileChange("notes/ghost.md", null, null)).toBeNull();
    });

    it("counts an emptied file's every line as removed", () => {
      expect(buildTurnFileChange("notes/a.md", "one\ntwo\n", "")).toMatchObject({
        status: "modified",
        additions: 0,
        deletions: 2,
      });
    });
  });
});
