import { revertReportedEdits } from "@/agentMode/session/reportedEdits";

describe("reportedEdits", () => {
  describe("revertReportedEdits()", () => {
    it("recovers the file the whole-file diff replaced", () => {
      expect(
        revertReportedEdits([{ oldText: "one\ntwo\n", newText: "ONE\ntwo\n" }], "ONE\ntwo\n")
      ).toEqual({ text: "one\ntwo\n" });
    });

    it("recovers the file from a hunk that appears once in it", () => {
      expect(
        revertReportedEdits([{ oldText: "- two", newText: "- TWO" }], "# List\n\n- one\n- TWO\n")
      ).toEqual({ text: "# List\n\n- one\n- two\n" });
    });

    it("undoes several edits to one file newest first", () => {
      const after = "# Note\n\nalpha two gamma\n";
      expect(
        revertReportedEdits(
          [
            { oldText: "one", newText: "ONE" },
            { oldText: "ONE", newText: "two" },
            { oldText: "a", newText: "alpha" },
          ],
          after
        )
      ).toEqual({ text: "# Note\n\na one gamma\n" });
    });

    it("reports no pre-turn content when the edits say the file was created", () => {
      expect(revertReportedEdits([{ oldText: null, newText: "fresh\n" }], "fresh\n")).toEqual({
        text: null,
      });
    });

    it("recovers the original when an edit was applied and then reverted", () => {
      expect(
        revertReportedEdits(
          [
            { oldText: "original", newText: "changed" },
            { oldText: "changed", newText: "original" },
          ],
          "original"
        )
      ).toEqual({ text: "original" });
    });

    it("refuses when the replaced text is not in the file, so a failed edit cannot invent history", () => {
      expect(
        revertReportedEdits([{ oldText: "one", newText: "never written" }], "one\n")
      ).toBeNull();
    });

    it("refuses when the replaced text appears more than once and the site is ambiguous", () => {
      expect(revertReportedEdits([{ oldText: "a", newText: "b" }], "b and b")).toBeNull();
    });

    it("refuses when a creation's new text is not the whole file", () => {
      expect(
        revertReportedEdits([{ oldText: null, newText: "fresh" }], "fresh and more")
      ).toBeNull();
    });

    it("refuses when the file is gone, since there is nothing to undo against", () => {
      expect(revertReportedEdits([{ oldText: "one", newText: "two" }], null)).toBeNull();
    });

    it("returns the file unchanged when the turn reported no edits", () => {
      expect(revertReportedEdits([], "same\n")).toEqual({ text: "same\n" });
    });
  });
});
