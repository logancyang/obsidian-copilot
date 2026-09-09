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
        recommend: search,
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
    it("keeps blank-only text local and reuses the empty result slice (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      const context = {
        id: "a",
        request: {
          folder_name: "Vault",
          messages: [{ role: "user" as const, content: "  " }],
          excerpts: [""],
          file_paths: [" "],
        },
        skippedAttachments: 0,
        addFile: jest.fn(),
      };
      const blank = await findChatRelevantNotes(app, context);
      expect(blank.status).toBe("no-usable-context");
      expect(search).not.toHaveBeenCalled();
      search.mockResolvedValue({ status: "ok", results: [], skipped_files: [] });
      const empty = await findChatRelevantNotes(app, {
        ...context,
        request: { folder_name: "Vault", draft: "topic" },
      });
      expect(empty.status).toBe("no-matches");
      expect(empty.notes).toBe(blank.notes);
      search.mockResolvedValue({
        status: "ok",
        results: [{ path: "Vault/a.md", score: 0.8 }],
        skipped_files: [],
      });
      const filtered = await findChatRelevantNotes(app, {
        ...context,
        request: { folder_name: "Vault", file_paths: ["Vault/a.md"] },
      });
      expect(filtered.notes).toBe(blank.notes);
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
    it("identifies only a structured unsupported route for host fallback (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      for (const errorCode of ["not_implemented", undefined]) {
        search.mockRejectedValue(new MiyoRequestError(501, "", errorCode));
        const result = await findChatRelevantNotes(app, {
          id: "a",
          request: { folder_name: "Vault", draft: "topic" },
          skippedAttachments: 0,
          addFile: jest.fn(),
        });
        expect(result.status).toBe(errorCode ? "unsupported-service" : "unavailable");
      }
    });
    it.each([
      [404, "unavailable"],
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
