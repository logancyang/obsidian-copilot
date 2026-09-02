import { getRelevantNotesPresentation } from "./relevantNotesPresentation";

describe("relevantNotesPresentation", () => {
  describe("getRelevantNotesPresentation()", () => {
    it.each([
      {
        status: "disabled" as const,
        guidanceId: "download",
        showPane: true,
        showRows: false,
      },
      {
        status: "unavailable" as const,
        guidanceId: "unavailable",
        showPane: true,
        showRows: false,
      },
      {
        status: "matches" as const,
        guidanceId: undefined,
        showPane: true,
        showRows: true,
      },
      {
        status: "no-matches" as const,
        guidanceId: "no-matches",
        showPane: true,
        showRows: true,
      },
      {
        status: "not-indexed" as const,
        guidanceId: "not-indexed",
        showPane: true,
        showRows: true,
      },
      {
        status: "idle" as const,
        guidanceId: undefined,
        showPane: true,
        showRows: false,
      },
      {
        status: "loading" as const,
        guidanceId: undefined,
        showPane: false,
        showRows: false,
      },
    ])(
      "maps $status to one complete pane descriptor (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      ({ status, guidanceId, showPane, showRows }) => {
        const presentation = getRelevantNotesPresentation(status, true, "miyo");

        expect(presentation).toMatchObject({ showPane, showRows });
        expect(presentation.guidance?.id).toBe(guidanceId);
        expect(presentation.layout).toBe(showRows ? "results" : "empty");
      }
    );

    it("uses an empty layout when a row-capable state has no rows (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      expect(getRelevantNotesPresentation("matches", false, "miyo").layout).toBe("empty");
    });

    it("selects the runtime-safe indexing review action (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const local = getRelevantNotesPresentation("not-indexed", false, "miyo");
      const remote = getRelevantNotesPresentation("not-indexed", false, "settings");

      expect(local.guidance?.actions).toEqual([
        { id: "refresh", label: "Refresh" },
        { id: "review-indexing", label: "Open Miyo" },
      ]);
      expect(remote.guidance?.actions).toEqual([
        { id: "refresh", label: "Refresh" },
        { id: "review-indexing", label: "Review Miyo connection" },
      ]);
    });
  });
});
