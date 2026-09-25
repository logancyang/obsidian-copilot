/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import {
  buildChatDeepLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { listMarkdownFiles, readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import type { App, TFile } from "obsidian";

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveConversationsFolder: () => "Copilot/conversations",
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  listMarkdownFiles: jest.fn(),
  readFrontmatterViaAdapter: jest.fn(),
}));

const mockList = jest.mocked(listMarkdownFiles);
const mockReadFrontmatter = jest.mocked(readFrontmatterViaAdapter);
const chat = (path: string) => ({ path }) as TFile;
const app = { metadataCache: { getCache: jest.fn() } } as unknown as App;
const mockGetCache = jest.mocked(app.metadataCache.getCache);

describe("chatDeepLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCache.mockReturnValue(null);
    mockList.mockResolvedValue([]);
    mockReadFrontmatter.mockResolvedValue(null);
  });

  describe("buildChatDeepLink()", () => {
    it("encodes the vault and chat id without exposing a file path", () => {
      expect(buildChatDeepLink("My Vault", "epoch:1735732800000")).toBe(
        "obsidian://copilot-chat?vault=My+Vault&id=epoch%3A1735732800000"
      );
    });
  });

  describe("getSavedChatDeepLinkId()", () => {
    it("uses the cached frontmatter epoch so a renamed note keeps its link", async () => {
      mockGetCache.mockReturnValue({ frontmatter: { epoch: 1735732800000 } } as never);
      expect(await getSavedChatDeepLinkId(app, "Copilot/conversations/renamed.md")).toBe(
        "epoch:1735732800000"
      );
    });

    it("reads the epoch from disk when the note is in a hidden folder", async () => {
      mockReadFrontmatter.mockResolvedValue({ epoch: "1735732800000" });
      expect(await getSavedChatDeepLinkId(app, ".copilot/conversations/chat.md")).toBe(
        "epoch:1735732800000"
      );
    });

    it("returns null when the note has no epoch", async () => {
      expect(await getSavedChatDeepLinkId(app, "Copilot/conversations/chat.md")).toBeNull();
    });
  });

  describe("findChatFileByDeepLinkId()", () => {
    it("resolves the conversation whose epoch matches after a file rename", async () => {
      const other = chat("Copilot/conversations/other.md");
      const renamed = chat("Copilot/conversations/renamed.md");
      mockList.mockResolvedValue([other, renamed]);
      mockReadFrontmatter.mockImplementation(async (_app, path) => ({
        epoch: path === renamed.path ? "1735732800000" : "1600000000000",
      }));
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBe(renamed);
      expect(mockList).toHaveBeenCalledWith(app, "Copilot/conversations");
    });

    it("returns null when no conversation owns the epoch", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations/chat.md")]);
      mockReadFrontmatter.mockResolvedValue({ epoch: "1600000000000" });
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBeNull();
    });

    it("never resolves an id that is not an epoch, such as a file path", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations/chat.md")]);
      expect(await findChatFileByDeepLinkId(app, "Copilot/conversations/chat.md")).toBeNull();
      expect(mockList).not.toHaveBeenCalled();
    });
  });
});
