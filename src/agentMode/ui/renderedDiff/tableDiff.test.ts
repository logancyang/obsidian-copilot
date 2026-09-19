import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import { diffTableBlock, splitTableRow } from "@/agentMode/ui/renderedDiff/tableDiff";

const deleted = (text: string): string => DEL_OPEN + text + DEL_CLOSE;
const inserted = (text: string): string => INS_OPEN + text + INS_CLOSE;

describe("tableDiff", () => {
  describe("splitTableRow()", () => {
    it("returns the trimmed cells without the pipes that delimit the row", () => {
      expect(splitTableRow("| Region | Partners | Status |")).toEqual([
        "Region",
        "Partners",
        "Status",
      ]);
    });

    it("keeps an escaped pipe inside its cell instead of starting a new column", () => {
      expect(splitTableRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
    });

    it("keeps an empty interior cell so the columns stay aligned", () => {
      expect(splitTableRow("| EMEA |  | Ready |")).toEqual(["EMEA", "", "Ready"]);
    });
  });

  describe("diffTableBlock()", () => {
    const header = "| Region | Partners | Status |\n| --- | --- | --- |";

    it("marks only the cell that changed and leaves the rest of the table untouched", () => {
      const merged = diffTableBlock(
        `${header}\n| EMEA | 2 | Ready |\n| APAC | 1 | Blocked |`,
        `${header}\n| EMEA | 3 | Ready |\n| APAC | 1 | Blocked |`
      );

      expect(merged).toBe(
        `${header}\n| EMEA | ${deleted("2")}${inserted("3")} | Ready |\n| APAC | 1 | Blocked |`
      );
    });

    it("marks every cell of an added row so the row reads as one insertion", () => {
      const merged = diffTableBlock(
        `${header}\n| EMEA | 2 | Ready |`,
        `${header}\n| EMEA | 2 | Ready |\n| AMER | 4 | Ready |`
      );

      expect(merged).toBe(
        `${header}\n| EMEA | 2 | Ready |\n| ${inserted("AMER")} | ${inserted("4")} | ${inserted(
          "Ready"
        )} |`
      );
    });

    it("keeps a removed row in the merged table with every cell marked deleted", () => {
      const merged = diffTableBlock(
        `${header}\n| EMEA | 2 | Ready |\n| APAC | 1 | Blocked |`,
        `${header}\n| EMEA | 2 | Ready |`
      );

      expect(merged).toBe(
        `${header}\n| EMEA | 2 | Ready |\n| ${deleted("APAC")} | ${deleted("1")} | ${deleted(
          "Blocked"
        )} |`
      );
    });

    it("refuses to merge tables whose column counts differ so the caller can replace the block whole", () => {
      const merged = diffTableBlock(
        "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |",
        `${header}\n| EMEA | 2 | Ready |`
      );

      expect(merged).toBeNull();
    });
  });
});
