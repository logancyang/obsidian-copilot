import { findChatRelevantNotes } from "@/search/findChatRelevantNotes";
import { MiyoClient, MiyoRequestError } from "@/miyo/MiyoClient";
import { App, TFile } from "obsidian";
jest.mock("@/settings/model", () => ({ getSettings: () => ({ plusLicenseKey: "key" }) }));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: () => "url",
  getMiyoFilePath: (_app: unknown, path: string) => `Vault/${path}`,
  getVaultRelativeMiyoPath: (_app: unknown, path: string) => path.replace(/^Vault\//, ""),
}));
jest.mock("@/miyo/MiyoClient", () => {
  const actual = jest.requireActual<typeof import("@/miyo/MiyoClient")>("@/miyo/MiyoClient");
  return { ...actual, MiyoClient: jest.fn() };
});
describe("findChatRelevantNotes", () => {
  describe("findChatRelevantNotes()", () => {
    const search = jest.fn();
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) =>
          Object.assign(new (TFile as unknown as new (path: string) => TFile)("file.md"), {
            path,
            basename: path.replace(".md", ""),
            extension: "md",
          }),
        getMarkdownFiles: () => [
          Object.assign(new (TFile as unknown as new (path: string) => TFile)("file.md"), {
            path: "b.md",
          }),
          Object.assign(new (TFile as unknown as new (path: string) => TFile)("file.md"), {
            path: "a.md",
          }),
        ],
      },
    } as unknown as App;
    beforeEach(() => {
      search.mockReset();
      (MiyoClient as unknown as jest.Mock).mockImplementation(() => ({
        resolveBaseUrl: async () => "url",
        searchRelatedContext: search,
        fetchHealth: async () => ({ status: "ok" }),
      }));
    });
    it("preserves order/scores, full-file exclusions and skipped count (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      search.mockResolvedValue({
        status: "ok",
        results: [
          { path: "Vault/b.md", score: 0.6 },
          { path: "Vault/a.md", score: 0.9 },
        ],
        skipped_files: [{ path: "Vault/missing.pdf", reason: "not_indexed" }],
      });
      const result = await findChatRelevantNotes(app, {
        id: "a",
        request: { folder_name: "Vault", draft: "topic", file_paths: ["Vault/a.md"] },
        skippedAttachments: 1,
        addFile: jest.fn(),
      });
      expect(result.notes.map((entry) => entry.note.path)).toEqual(["b.md"]);
      expect(result.notes[0].metadata.score).toBe(0.6);
      expect(result.details?.skippedAttachments).toBe(2);
    });
    it("keeps unsupported-only context unavailable without a request (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const result = await findChatRelevantNotes(app, {
        id: "a",
        request: { folder_name: "Vault" },
        skippedAttachments: 1,
        addFile: jest.fn(),
      });
      expect(result.status).toBe("no-usable-context");
      expect(search).not.toHaveBeenCalled();
    });
    it("uses an explicitly labeled fixture without a service request (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const result = await findChatRelevantNotes(
        app,
        {
          id: "a",
          request: { folder_name: "Vault", draft: "topic" },
          skippedAttachments: 0,
          addFile: jest.fn(),
        },
        true
      );
      expect(result.details?.mock).toBe(true);
      expect(result.notes.map((entry) => entry.note.path)).toEqual(["a.md", "b.md"]);
      expect(search).not.toHaveBeenCalled();
    });
    it.each([
      [404, "unsupported-service"],
      [400, "request-error"],
      [413, "request-too-large"],
      [503, "unavailable"],
    ])(
      "classifies HTTP %s as %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      async (code, status) => {
        search.mockRejectedValue(new MiyoRequestError(code, ""));
        expect(
          (
            await findChatRelevantNotes(app, {
              id: "a",
              request: { folder_name: "Vault", draft: "topic" },
              skippedAttachments: 0,
              addFile: jest.fn(),
            })
          ).status
        ).toBe(status);
      }
    );
  });
});
