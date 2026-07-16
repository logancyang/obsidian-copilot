// isSelfHostModeValidFor is a pure predicate over the passed settings; keep the
// real implementation so seedDocProcessorBackend tests drive it via the settings
// snapshot (proving purity) rather than through a global mock.
jest.mock("@/plusUtils", () => ({
  isSelfHostModeValidFor: (settings: { enableSelfHostMode?: boolean }): boolean =>
    settings.enableSelfHostMode === true,
}));

// The status store is owned by another PR-2 workstream (contract stub in this
// worktree). getDocProcessorBackend hard-gates on this predicate, so we mock it.
jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
}));

import { Platform, type App } from "obsidian";
import { isMiyoAvailableForCapability } from "@/miyo/miyoStatusStore";
import type { CopilotSettings } from "@/settings/model";
import {
  getDocProcessorBackend,
  getMiyoFilePath,
  getMiyoFolderExclusions,
  getMiyoFolderInclusions,
  getMiyoFolderName,
  getSearchBackend,
  getVaultRelativeMiyoPath,
  isLocalMiyoUrl,
  seedDocProcessorBackend,
} from "@/miyo/miyoUtils";

const mockAvailable = isMiyoAvailableForCapability as jest.MockedFunction<
  typeof isMiyoAvailableForCapability
>;

/** Minimal settings stub; the accessors only read the fields set per-test. */
const capSettings = (over: Partial<CopilotSettings>): CopilotSettings =>
  ({ enableMiyo: false, miyoServerUrl: "", ...over }) as CopilotSettings;

describe("getMiyoFolderName", () => {
  it("uses the vault folder name even when an adapter exposes an absolute path", () => {
    const folderName = getMiyoFolderName({
      vault: {
        getName: () => "graham-essays-main",
        adapter: {
          getBasePath: () => "\\\\Mac\\Home\\Downloads\\graham-essays-main",
        },
      },
    } as unknown as App);

    expect(folderName).toBe("graham-essays-main");
  });
});

describe("getVaultRelativeMiyoPath", () => {
  const buildApp = (vaultName: string): App =>
    ({
      vault: {
        getName: () => vaultName,
      },
    }) as unknown as App;

  it("strips the current vault folder-name prefix", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "MyVault/notes/foo.md")).toBe(
      "notes/foo.md"
    );
  });

  it("returns the normalized path unchanged when the prefix matches a different vault", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "OtherVault/notes/foo.md")).toBe(
      "OtherVault/notes/foo.md"
    );
  });

  it("normalizes separators even when the prefix does not match", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "OtherVault\\notes\\foo.md")).toBe(
      "OtherVault/notes/foo.md"
    );
  });

  it("only strips the leading prefix once", () => {
    expect(getVaultRelativeMiyoPath(buildApp("Test"), "Test/Test/foo.md")).toBe("Test/foo.md");
  });

  it("normalizes backslash separators before stripping", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "MyVault\\notes\\foo.md")).toBe(
      "notes/foo.md"
    );
  });

  it("returns the normalized path when the vault folder name is empty", () => {
    expect(getVaultRelativeMiyoPath(buildApp(""), "notes\\foo.md")).toBe("notes/foo.md");
  });
});

describe("getMiyoFilePath", () => {
  const buildApp = (vaultName: string): App =>
    ({
      vault: {
        getName: () => vaultName,
      },
    }) as unknown as App;

  it("prefixes the vault folder name to a vault-relative path", () => {
    expect(getMiyoFilePath(buildApp("MyVault"), "notes/foo.md")).toBe("MyVault/notes/foo.md");
  });

  it("normalizes backslash separators before prefixing", () => {
    expect(getMiyoFilePath(buildApp("MyVault"), "notes\\foo.md")).toBe("MyVault/notes/foo.md");
  });

  it("strips a leading slash from the input so the result has no duplicate separator", () => {
    expect(getMiyoFilePath(buildApp("MyVault"), "/notes/foo.md")).toBe("MyVault/notes/foo.md");
  });

  it("round-trips with getVaultRelativeMiyoPath", () => {
    const app = buildApp("MyVault");
    const original = "notes/foo.md";
    expect(getVaultRelativeMiyoPath(app, getMiyoFilePath(app, original))).toBe(original);
  });

  it("returns the normalized path when the vault folder name is empty", () => {
    expect(getMiyoFilePath(buildApp(""), "notes/foo.md")).toBe("notes/foo.md");
  });
});

// getSearchBackend stays behavior-neutral: it derives from the live shouldUseMiyo
// predicate (there is no persisted search-engine field). getDocProcessorBackend,
// by contrast, has been flipped (Layer C) to read the persisted field plus live
// availability — its tests live in a separate block below.
describe("getSearchBackend", () => {
  // Miyo is free (Layer C): the search backend keys off enableMiyo only, plus the
  // mobile guard (local discovery is desktop-only, so mobile needs a server URL).
  afterEach(() => {
    (Platform as { isMobile: boolean }).isMobile = false;
  });

  it("returns 'miyo' when Miyo is enabled on desktop", () => {
    expect(getSearchBackend(capSettings({ enableMiyo: true }))).toBe("miyo");
  });

  it("returns 'keyword' when Miyo is disabled", () => {
    expect(getSearchBackend(capSettings({ enableMiyo: false }))).toBe("keyword");
  });

  it("returns 'keyword' on mobile without a server URL even when Miyo is enabled", () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    expect(getSearchBackend(capSettings({ enableMiyo: true, miyoServerUrl: "" }))).toBe("keyword");
  });

  it("returns 'miyo' on mobile when a server URL is configured", () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    expect(
      getSearchBackend(capSettings({ enableMiyo: true, miyoServerUrl: "http://host:8742" }))
    ).toBe("miyo");
  });
});

// seedDocProcessorBackend is the pure migration seed: a deterministic function of
// the passed snapshot's fields (enableSelfHostMode + enableMiyo), independent of
// live status or global settings.
describe("seedDocProcessorBackend", () => {
  it("returns 'miyo' when self-host mode is valid and Miyo is enabled", () => {
    expect(
      seedDocProcessorBackend(capSettings({ enableSelfHostMode: true, enableMiyo: true }))
    ).toBe("miyo");
  });

  it("returns 'plus' when self-host mode is off", () => {
    expect(
      seedDocProcessorBackend(capSettings({ enableSelfHostMode: false, enableMiyo: true }))
    ).toBe("plus");
  });

  it("returns 'plus' when Miyo is disabled", () => {
    expect(
      seedDocProcessorBackend(capSettings({ enableSelfHostMode: true, enableMiyo: false }))
    ).toBe("plus");
  });
});

describe("getDocProcessorBackend", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 'plus' when the field is 'plus', without consulting availability", () => {
    mockAvailable.mockReturnValue(true);
    expect(getDocProcessorBackend(capSettings({ docProcessorBackend: "plus" }))).toBe("plus");
    // Field short-circuits: no need to probe Miyo when the user isn't on it.
    expect(mockAvailable).not.toHaveBeenCalled();
  });

  it("returns 'miyo' when the field is 'miyo' and Miyo is available", () => {
    mockAvailable.mockReturnValue(true);
    expect(getDocProcessorBackend(capSettings({ docProcessorBackend: "miyo" }))).toBe("miyo");
    expect(mockAvailable).toHaveBeenCalledWith("documentProcessor");
  });

  it("falls back to 'plus' when the field is 'miyo' but Miyo is unavailable", () => {
    // Dead-path guard: a stale "miyo" field must not route PDFs to unreachable Miyo.
    mockAvailable.mockReturnValue(false);
    expect(getDocProcessorBackend(capSettings({ docProcessorBackend: "miyo" }))).toBe("plus");
  });
});

describe("isLocalMiyoUrl", () => {
  it("treats an empty/blank URL as local (discovery)", () => {
    expect(isLocalMiyoUrl("")).toBe(true);
    expect(isLocalMiyoUrl("   ")).toBe(true);
  });

  it("treats loopback hosts as local", () => {
    expect(isLocalMiyoUrl("http://localhost:8742")).toBe(true);
    expect(isLocalMiyoUrl("http://127.0.0.1:8742")).toBe(true);
    expect(isLocalMiyoUrl("http://127.1.2.3:8742")).toBe(true);
    expect(isLocalMiyoUrl("http://[::1]:8742")).toBe(true);
    expect(isLocalMiyoUrl("http://app.localhost:8742")).toBe(true);
  });

  it("treats LAN / public hosts as remote", () => {
    expect(isLocalMiyoUrl("http://192.168.1.10:8742")).toBe(false);
    expect(isLocalMiyoUrl("https://miyo.example.com")).toBe(false);
  });

  it("treats an unparseable URL as remote (safe default)", () => {
    // A scheme-less "localhost:8742" doesn't parse as a normal http URL; falling
    // back to the manual add flow is safer than POSTing a local path to it.
    expect(isLocalMiyoUrl("not a url")).toBe(false);
  });
});

describe("getMiyoFolderExclusions", () => {
  it("returns a frozen empty object for blank input, referentially stable", () => {
    const first = getMiyoFolderExclusions("");
    const second = getMiyoFolderExclusions("   ");
    expect(first).toEqual({});
    expect(Object.isFrozen(first)).toBe(true);
    // Same frozen constant, not a fresh {} each call.
    expect(first).toBe(second);
  });

  it("maps folder paths to exclude_folders, stripping only trailing slashes", () => {
    // Mirrors Copilot's folder matcher: a trailing slash is cosmetic, but a leading
    // "/" or "./" is a dead pattern in Copilot and must stay literal here so Miyo
    // doesn't over-exclude a folder Copilot still indexes.
    expect(getMiyoFolderExclusions("archive, drafts/, ./notes, /private")).toEqual({
      exclude_folders: ["archive", "drafts", "./notes", "/private"],
    });
  });

  it("maps *.ext patterns to root-recursive exclude_patterns globs", () => {
    expect(getMiyoFolderExclusions("*.pdf, *.png")).toEqual({
      exclude_patterns: ["**/*.pdf", "**/*.png"],
    });
  });

  it("drops root/parent pointers so the whole vault is never excluded", () => {
    // "./" → "." and bare "." / ".." would make Miyo exclude the vault root (and
    // thus everything) from indexing — the dangerous over-exclusion direction.
    expect(getMiyoFolderExclusions("./")).toEqual({});
    expect(getMiyoFolderExclusions(".")).toEqual({});
    expect(getMiyoFolderExclusions("..")).toEqual({});
    // A real folder alongside a bare "." keeps the folder but discards the pointer.
    expect(getMiyoFolderExclusions("archive, .")).toEqual({ exclude_folders: ["archive"] });
  });

  it("drops tag and note exclusions that have no Miyo equivalent", () => {
    // #tag and [[note]] can't be expressed as folder/glob excludes → omitted.
    expect(getMiyoFolderExclusions("#archive, [[Scratch]]")).toEqual({});
  });

  it("combines folder and extension excludes while dropping tags/notes", () => {
    expect(getMiyoFolderExclusions("copilot, *.pdf, #wip")).toEqual({
      exclude_folders: ["copilot"],
      exclude_patterns: ["**/*.pdf"],
    });
  });

  it("merges Obsidian's excluded files (userIgnoreFilters) into exclude_folders", () => {
    // The vault-level "Excluded files" the user hid in Obsidian must be honored by
    // Miyo registration too, alongside Copilot's own qaExclusions.
    expect(getMiyoFolderExclusions("archive", ["private", "secrets/"])).toEqual({
      exclude_folders: ["archive", "private", "secrets"],
    });
  });

  it("de-duplicates a folder present in both qaExclusions and Obsidian ignores", () => {
    expect(getMiyoFolderExclusions("archive", ["archive"])).toEqual({
      exclude_folders: ["archive"],
    });
  });

  it("applies Obsidian ignores even when qaExclusions is blank", () => {
    expect(getMiyoFolderExclusions("", ["private"])).toEqual({
      exclude_folders: ["private"],
    });
  });

  it("drops root/parent pointers from Obsidian ignores too", () => {
    // A userIgnoreFilters entry that normalizes to "." must not exclude the whole vault.
    expect(getMiyoFolderExclusions("", [".", "./"])).toEqual({});
  });
});

describe("getMiyoFolderInclusions", () => {
  it("returns a frozen empty object for blank input, referentially stable", () => {
    const first = getMiyoFolderInclusions("");
    const second = getMiyoFolderInclusions("   ");
    expect(first).toEqual({});
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toBe(second);
  });

  it("maps folder paths to include_folders, stripping only trailing slashes", () => {
    expect(getMiyoFolderInclusions("projects, inbox/")).toEqual({
      include_folders: ["projects", "inbox"],
    });
  });

  it("maps *.ext patterns to bare include_extensions (no glob wildcard)", () => {
    // Unlike excludes (which become **/*.ext globs), include_extensions takes the
    // bare extension per the Miyo folder API.
    expect(getMiyoFolderInclusions("*.md, *.txt")).toEqual({
      include_extensions: ["md", "txt"],
    });
  });

  it("combines folder and extension includes", () => {
    expect(getMiyoFolderInclusions("projects, *.md")).toEqual({
      include_folders: ["projects"],
      include_extensions: ["md"],
    });
  });

  it("FALLS BACK to no filter when a #tag inclusion is present (never over-restricts)", () => {
    // The whitelist can't express a tag. Sending include_folders:["projects"] while
    // dropping "#work" would make Miyo index ONLY projects and silently exclude all
    // #work notes elsewhere. Safe direction: send no include filter → index all.
    expect(getMiyoFolderInclusions("#work, projects")).toEqual({});
  });

  it("FALLS BACK to no filter when a [[note]] inclusion is present", () => {
    expect(getMiyoFolderInclusions("[[Daily]], *.md")).toEqual({});
  });

  it("drops root/parent pointers from include_folders", () => {
    expect(getMiyoFolderInclusions("./")).toEqual({});
    expect(getMiyoFolderInclusions("projects, .")).toEqual({ include_folders: ["projects"] });
  });
});
