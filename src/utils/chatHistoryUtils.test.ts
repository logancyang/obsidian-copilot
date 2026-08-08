/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import { fileToHistoryItem } from "@/utils/chatHistoryUtils";
import type { RecentUsageManager } from "@/utils/recentUsageManager";
import type { App, TFile } from "obsidian";

jest.mock("obsidian", () => ({ App: jest.fn(), TFile: jest.fn() }));
jest.mock("@/utils", () => ({
  formatDateTime: jest.fn(() => ({ display: "2026/01/01 12:00:00", fileName: "20260101_120000" })),
}));
jest.mock("@/projects/projectPaths", () => ({
  sanitizeVaultPathSegment: jest.fn((s: string) => s),
}));
jest.mock("@/projects/state", () => ({
  getCachedProjectRecords: jest.fn(() => []),
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  readFrontmatterViaAdapter: jest.fn().mockResolvedValue(null),
}));

/** A RecentUsageManager stub that echoes the persisted timestamp back. */
const lastAccessedStub = {
  getEffectiveLastUsedAt: (_path: string, persisted?: number | null) => persisted ?? 0,
} as unknown as RecentUsageManager<string>;

/**
 * Build an `app` whose metadataCache returns the given frontmatter for any
 * file, so we can assert how `fileToHistoryItem` reads scope metadata.
 */
function makeApp(frontmatter: Record<string, unknown>) {
  return {
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter })),
    },
  } as unknown as App;
}

function makeFile(): TFile {
  return {
    path: "test-folder/agent__chat.md",
    basename: "agent__chat",
    stat: { ctime: 1735732800000, mtime: 1735732800000 },
  } as unknown as TFile;
}

describe("fileToHistoryItem projectId extraction", () => {
  it("extracts a string projectId from frontmatter", () => {
    const app = makeApp({ epoch: 1735732800000, projectId: "proj-123" });
    const item = fileToHistoryItem(app, makeFile(), lastAccessedStub);
    expect(item.projectId).toBe("proj-123");
  });

  it("coerces a numeric projectId (unquoted YAML) to a string", () => {
    const app = makeApp({ epoch: 1735732800000, projectId: 123 });
    const item = fileToHistoryItem(app, makeFile(), lastAccessedStub);
    expect(item.projectId).toBe("123");
  });

  it("leaves projectId undefined when absent (no GLOBAL_SCOPE default in this layer)", () => {
    const app = makeApp({ epoch: 1735732800000 });
    const item = fileToHistoryItem(app, makeFile(), lastAccessedStub);
    expect(item.projectId).toBeUndefined();
  });

  it("treats a blank projectId as undefined", () => {
    const app = makeApp({ epoch: 1735732800000, projectId: "   " });
    const item = fileToHistoryItem(app, makeFile(), lastAccessedStub);
    expect(item.projectId).toBeUndefined();
  });
});
