import { checkLatestRelease } from "@/utils/latestRelease";
import { requestUrl } from "obsidian";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
const mockedRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;

describe("latestRelease", () => {
  describe("checkLatestRelease()", () => {
    beforeEach(() => {
      mockedRequestUrl.mockReset();
    });

    it(`returns the release body and destination from the version-check request for ${ISSUE_URL}`, async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        text: "",
        json: {
          tag_name: "v4.0.4",
          body: "# Copilot 4.0.4",
          html_url: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
        },
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      });

      await expect(checkLatestRelease()).resolves.toEqual({
        error: null,
        release: {
          version: "4.0.4",
          body: "# Copilot 4.0.4",
          htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
        },
      });
      expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    it("returns an error when GitHub does not provide a release tag", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        text: "",
        json: {},
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      });

      await expect(checkLatestRelease()).resolves.toEqual({
        error: "The latest Copilot release has no version tag.",
        release: null,
      });
    });

    it("returns the request error when GitHub cannot be reached", async () => {
      mockedRequestUrl.mockRejectedValue(new Error("offline"));

      await expect(checkLatestRelease()).resolves.toEqual({
        error: "offline",
        release: null,
      });
    });
  });
});
