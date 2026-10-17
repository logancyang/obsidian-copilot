import { MiyoRequestError } from "@/miyo/MiyoClient";
import { searchWithoutMissingFolders } from "./searchWithoutMissingFolders";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const RESPONSE = { results: [] };
const notRegistered = (name: string) => new MiyoRequestError(404, `Folder not registered: ${name}`);

describe("searchWithoutMissingFolders", () => {
  describe("searchWithoutMissingFolders()", () => {
    it("searches every ticked folder when Miyo knows them all", async () => {
      const search = jest.fn().mockResolvedValue(RESPONSE);

      const searched = await searchWithoutMissingFolders(search, ["Research", "Archive"]);

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith(["Research", "Archive"]);
      expect(searched).toEqual({ response: RESPONSE, extraFolders: ["Research", "Archive"] });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 drops each missing folder and searches the rest", async () => {
      const search = jest
        .fn()
        .mockRejectedValueOnce(notRegistered("Archive"))
        .mockRejectedValueOnce(notRegistered("Research"))
        .mockResolvedValue(RESPONSE);

      const searched = await searchWithoutMissingFolders(search, ["Research", "Archive", "Notes"]);

      expect(search.mock.calls).toEqual([
        [["Research", "Archive", "Notes"]],
        [["Research", "Notes"]],
        [["Notes"]],
      ]);
      expect(searched.extraFolders).toEqual(["Notes"]);
    });

    it.each([
      ["a folder that was not ticked", notRegistered("step-1")],
      ["a non-404 failure", new MiyoRequestError(503, "Folder not registered: Research")],
      ["a plain error", new Error("connection refused")],
    ])("rethrows %s without retrying", async (_label, error) => {
      const search = jest.fn().mockRejectedValue(error);

      await expect(searchWithoutMissingFolders(search, ["Research"])).rejects.toBe(error);
      expect(search).toHaveBeenCalledTimes(1);
    });
  });
});
