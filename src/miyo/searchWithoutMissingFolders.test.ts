import { MiyoRequestError } from "@/miyo/MiyoClient";
import { searchWithoutMissingFolders } from "./searchWithoutMissingFolders";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const RESPONSE = { results: [] };
const notRegistered = (name: string) => new MiyoRequestError(404, `Folder not registered: ${name}`);

describe("searchWithoutMissingFolders", () => {
  describe("searchWithoutMissingFolders()", () => {
    it("searches every ticked folder when Miyo knows them all", async () => {
      const search = jest.fn().mockResolvedValue(RESPONSE);

      const searched = await searchWithoutMissingFolders(search, "step-1", ["Research", "Archive"]);

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith(["step-1", "Research", "Archive"]);
      expect(searched).toEqual({ response: RESPONSE, extraFolders: ["Research", "Archive"] });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 drops each missing folder and searches the rest", async () => {
      const search = jest
        .fn()
        .mockRejectedValueOnce(notRegistered("Archive"))
        .mockRejectedValueOnce(notRegistered("Research"))
        .mockResolvedValue(RESPONSE);

      const searched = await searchWithoutMissingFolders(search, "step-1", [
        "Research",
        "Archive",
        "Notes",
      ]);

      expect(search.mock.calls).toEqual([
        [["step-1", "Research", "Archive", "Notes"]],
        [["step-1", "Research", "Notes"]],
        [["step-1", "Notes"]],
      ]);
      expect(searched.extraFolders).toEqual(["Notes"]);
    });

    it.each([
      ["no ticked folder is left", "step-1", []],
      ["the search is unrestricted", undefined, []],
    ])(
      "https://github.com/logancyang/obsidian-copilot/issues/3508 sends no folder list when %s, so Miyo searches folder_name alone",
      async (_label, folderName, extraFolders) => {
        const search = jest.fn().mockResolvedValue(RESPONSE);

        await searchWithoutMissingFolders(search, folderName, extraFolders);

        expect(search).toHaveBeenCalledWith(undefined);
      }
    );

    it.each([
      ["a folder that was not ticked", notRegistered("step-1")],
      ["a non-404 failure", new MiyoRequestError(503, "Folder not registered: Research")],
      ["a plain error", new Error("connection refused")],
    ])("rethrows %s without retrying", async (_label, error) => {
      const search = jest.fn().mockRejectedValue(error);

      await expect(searchWithoutMissingFolders(search, "step-1", ["Research"])).rejects.toBe(error);
      expect(search).toHaveBeenCalledTimes(1);
    });
  });
});
