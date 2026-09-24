/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import {
  buildChatDeepLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
  parseChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { listMarkdownFiles } from "@/utils/vaultAdapterUtils";
import type { App, TFile } from "obsidian";

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveConversationsFolder: () => "Copilot/conversations",
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  listMarkdownFiles: jest.fn(),
}));

const mockList = jest.mocked(listMarkdownFiles);
const chat = (path: string) => ({ path }) as TFile;
const app = {
  metadataCache: { getFileCache: jest.fn() },
  vault: { adapter: { read: jest.fn() } },
} as unknown as App;
const mockRead = jest.mocked(app.vault.adapter.read);

describe("chatDeepLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(app.metadataCache.getFileCache).mockReset();
    mockList.mockResolvedValue([]);
    mockRead.mockResolvedValue("");
  });

  describe("buildChatDeepLink()", () => {
    it("encodes the vault and stable epoch without exposing a file path", () => {
      expect(buildChatDeepLink("My Vault", "epoch:1735732800000")).toBe(
        "obsidian://copilot-chat?vault=My+Vault&id=epoch%3A1735732800000"
      );
    });

    it("encodes an existing native agent session identity", () => {
      expect(buildChatDeepLink("Vault", "copilot-agent-session://codex/abc%2Fdef")).toContain(
        "id=copilot-agent-session%3A%2F%2Fcodex%2Fabc%252Fdef"
      );
    });
  });

  describe("parseChatDeepLinkId()", () => {
    it("accepts a canonical epoch and native session identity", () => {
      expect(parseChatDeepLinkId("epoch:1735732800000")).toBe("epoch:1735732800000");
      expect(parseChatDeepLinkId("copilot-agent-session://codex/abc%2Fdef")).toBe(
        "copilot-agent-session://codex/abc%2Fdef"
      );
    });

    it("rejects malformed IDs and paths https://github.com/logancyang/obsidian-copilot/issues/3271", () => {
      for (const id of [
        "Copilot/conversations/chat.md",
        "epoch:0",
        "epoch:01",
        "epoch:1.5",
        "epoch:9007199254740992",
        "copilot-agent-session://codex/",
        "copilot-agent-session://codex/%00",
        "copilot-agent-session://codex/abc/def",
        "copilot-agent-session://codex/%GG",
      ])
        expect(parseChatDeepLinkId(id)).toBeNull();
    });
  });

  describe("getSavedChatDeepLinkId()", () => {
    it("uses the stored epoch of a renamed chat", async () => {
      const file = chat("Copilot/conversations/renamed.md");
      mockList.mockResolvedValue([file]);
      jest.mocked(app.metadataCache.getFileCache).mockReturnValue({
        frontmatter: { epoch: 1735732800000, tags: ["copilot-conversation"] },
      } as unknown as ReturnType<typeof app.metadataCache.getFileCache>);
      expect(await getSavedChatDeepLinkId(app, file.path)).toBe("epoch:1735732800000");
      expect(mockList).toHaveBeenCalledWith(app, "Copilot/conversations");
    });

    it("rejects a note outside the configured folder https://github.com/logancyang/obsidian-copilot/issues/3271", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations-backup/private.md")]);
      expect(await getSavedChatDeepLinkId(app, "private.md")).toBeNull();
      expect(
        await getSavedChatDeepLinkId(app, "Copilot/conversations-backup/private.md")
      ).toBeNull();
    });

    it("reads hidden-folder frontmatter when the metadata cache has no note", async () => {
      const file = chat("Copilot/conversations/hidden.md");
      mockList.mockResolvedValue([file]);
      mockRead.mockResolvedValue(
        "---\nepoch: 1735732800000\ntags:\n  - copilot-conversation\n---\n"
      );
      expect(await getSavedChatDeepLinkId(app, file.path)).toBe("epoch:1735732800000");
    });

    it("uses an Agent Mode note's saved epoch with the same link format", async () => {
      const file = chat("Copilot/conversations/agent-chat.md");
      mockList.mockResolvedValue([file]);
      mockRead.mockResolvedValue(
        "---\nepoch: 1735732800000\nmode: agent\ntags:\n  - copilot-conversation\n---\n"
      );
      expect(await getSavedChatDeepLinkId(app, file.path)).toBe("epoch:1735732800000");
    });

    it("refuses to copy an ambiguous epoch https://github.com/logancyang/obsidian-copilot/issues/3271", async () => {
      mockList.mockResolvedValue([
        chat("Copilot/conversations/first.md"),
        chat("Copilot/conversations/second.md"),
      ]);
      mockRead.mockResolvedValue(
        "---\nepoch: 1735732800000\ntags:\n  - copilot-conversation\n---\n"
      );
      expect(await getSavedChatDeepLinkId(app, "Copilot/conversations/first.md")).toBeNull();
    });
  });

  describe("findChatFileByDeepLinkId()", () => {
    it("resolves a saved chat by epoch after a file rename", async () => {
      const file = chat("Copilot/conversations/renamed.md");
      mockList.mockResolvedValue([file]);
      mockRead.mockResolvedValue(
        "---\nepoch: 1735732800000\ntags:\n  - copilot-conversation\n---\n"
      );
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBe(file);
    });

    it("rejects duplicate epoch matches https://github.com/logancyang/obsidian-copilot/issues/3271", async () => {
      mockList.mockResolvedValue([
        chat("Copilot/conversations/first.md"),
        chat("Copilot/conversations/second.md"),
      ]);
      mockRead.mockResolvedValue(
        "---\nepoch: 1735732800000\ntags:\n  - copilot-conversation\n---\n"
      );
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBeNull();
    });

    it("ignores a non-chat note even when its epoch matches", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations/note.md")]);
      mockRead.mockResolvedValue("---\nepoch: 1735732800000\n---\n");
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBeNull();
    });

    it("ignores a matching note in a sibling folder https://github.com/logancyang/obsidian-copilot/issues/3271", async () => {
      mockList.mockResolvedValue([chat("Copilot/conversations-backup/private.md")]);
      mockRead.mockResolvedValue(
        "---\nepoch: 1735732800000\ntags:\n  - copilot-conversation\n---\n"
      );
      expect(await findChatFileByDeepLinkId(app, "epoch:1735732800000")).toBeNull();
    });
  });
});
