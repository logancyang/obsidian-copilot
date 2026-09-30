/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import {
  buildChatDeepLink,
  buildMarkdownChatLink,
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
    it("percent-encodes spaces in vault names so Obsidian can route chat links", () => {
      expect(buildChatDeepLink("My Vault", "epoch:1735732800000")).toBe(
        "obsidian://copilot-chat?vault=My%20Vault&id=epoch%3A1735732800000"
      );
    });

    it("preserves literal plus signs and reserved characters in the vault and chat id", () => {
      expect(buildChatDeepLink("My+Vault & Notes", "agent:foo+bar&baz")).toBe(
        "obsidian://copilot-chat?vault=My%2BVault%20%26%20Notes&id=agent%3Afoo%2Bbar%26baz"
      );
    });

    it("keeps simple vault names and chat ids readable", () => {
      expect(buildChatDeepLink("Work", "epoch:1735732800000")).toBe(
        "obsidian://copilot-chat?vault=Work&id=epoch%3A1735732800000"
      );
    });

    it("retains percent encoding for punctuation and Unicode in vault names", () => {
      expect(buildChatDeepLink("O'Brien ~!(東京)", "epoch:1")).toBe(
        "obsidian://copilot-chat?vault=O%27Brien%20%7E%21%28%E6%9D%B1%E4%BA%AC%29&id=epoch%3A1"
      );
    });
  });

  describe("buildMarkdownChatLink()", () => {
    it("uses the chat title as the label and a percent-encoded deep link as the target", () => {
      const deepLink = buildChatDeepLink("My Vault", "epoch:1735732800000");
      expect(buildMarkdownChatLink("Planning chat", deepLink)).toBe(
        "[Planning chat](obsidian://copilot-chat?vault=My%20Vault&id=epoch%3A1735732800000)"
      );
    });

    it("preserves brackets, slashes, emphasis, entities, and line breaks in the visible label (https://github.com/Brevilabs/obsidian-copilot-private/issues/615)", () => {
      expect(
        buildMarkdownChatLink("A [plan] \\ *draft* &amp;\n_next_", "obsidian://copilot-chat?id=1")
      ).toBe("[A \\[plan\\] \\\\ \\*draft\\* \\&amp; \\_next\\_](obsidian://copilot-chat?id=1)");
    });
  });

  describe("getSavedChatDeepLinkId()", () => {
    it("uses the cached frontmatter epoch so a renamed note keeps its link", async () => {
      mockGetCache.mockReturnValue({ frontmatter: { epoch: 1735732800000 } } as never);
      expect(await getSavedChatDeepLinkId(app, "Copilot/conversations/renamed.md")).toBe(
        "epoch:1735732800000"
      );
    });

    it("reads the epoch from disk when the note is in a hidden folder (https://github.com/logancyang/obsidian-copilot/issues/3271)", async () => {
      mockReadFrontmatter.mockResolvedValue({ epoch: "1735732800000" });
      expect(await getSavedChatDeepLinkId(app, ".copilot/conversations/chat.md")).toBe(
        "epoch:1735732800000"
      );
    });

    it("returns null when the note has no epoch", async () => {
      expect(await getSavedChatDeepLinkId(app, "Copilot/conversations/chat.md")).toBeNull();
    });

    it("returns null for a fractional epoch the link grammar cannot express (https://github.com/logancyang/obsidian-copilot/issues/3271)", async () => {
      mockGetCache.mockReturnValue({ frontmatter: { epoch: 1.5 } } as never);
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

    it("ignores a matching note in a sibling folder that shares the folder's name prefix (https://github.com/logancyang/obsidian-copilot/issues/3271)", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations-backup/chat.md")]);
      mockReadFrontmatter.mockResolvedValue({ epoch: "1735732800000" });
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBeNull();
    });

    it("returns null when two conversations share the epoch, such as a sync conflict copy (https://github.com/logancyang/obsidian-copilot/issues/3271)", async () => {
      mockList.mockResolvedValue([
        chat("Copilot/conversations/chat.md"),
        chat("Copilot/conversations/chat (conflicted copy).md"),
      ]);
      mockReadFrontmatter.mockResolvedValue({ epoch: "1735732800000" });
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBeNull();
    });

    it("never resolves an id that is not an epoch, such as a file path", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations/chat.md")]);
      expect(await findChatFileByDeepLinkId(app, "Copilot/conversations/chat.md")).toBeNull();
      expect(mockList).not.toHaveBeenCalled();
    });
  });
});
