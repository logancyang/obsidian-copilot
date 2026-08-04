// miyoUtils imports isMiyoAvailableForCapability (used by resolveDocProcessorBackend,
// which is covered end-to-end in FileParserManager.test.ts). Stub the status store
// so importing the module here doesn't pull in the real store.
jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));

// Pin the device id so receipts built in different test runs stay comparable.
jest.mock("@/utils/deviceId", () => ({
  getDeviceId: jest.fn(() => "device-A"),
}));

import { Platform, type App } from "obsidian";
import type { CopilotSettings } from "@/settings/model";
import {
  buildMiyoSyncReceipt,
  didMiyoSyncedRootsChange,
  getMiyoFilePath,
  getMiyoFolderExclusions,
  getMiyoFolderInclusions,
  getMiyoFolderName,
  getSearchBackend,
  getVaultRelativeMiyoPath,
  hasUserQaPatterns,
  isCurrentVaultMiyoPath,
  isLocalMiyoUrl,
  isMiyoScopeMismatch,
  seedDocProcessorBackend,
  shouldSurfaceMiyoResync,
} from "@/miyo/miyoUtils";

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

describe("isCurrentVaultMiyoPath", () => {
  const buildApp = (vaultName: string): App =>
    ({
      vault: {
        getName: () => vaultName,
      },
    }) as unknown as App;

  it("owns a raw path prefixed with the current vault's folder name", () => {
    expect(isCurrentVaultMiyoPath(buildApp("MyVault"), "MyVault/copilot/x.md")).toBe(true);
  });

  it("disowns a raw path prefixed with another folder's name, even one matching a system root", () => {
    // "copilot" is the default Copilot root NAME — but as a raw prefix it is
    // another Miyo folder's namespace, not this vault's content.
    expect(isCurrentVaultMiyoPath(buildApp("MyVault"), "copilot/notes/foo.md")).toBe(false);
  });

  it("claims ownership when no folder name is resolvable (conservative: filters still apply)", () => {
    expect(isCurrentVaultMiyoPath(buildApp(""), "notes/foo.md")).toBe(true);
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
// predicate (there is no persisted search-engine field).
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

  it("FALLS BACK to no filter when a [key:value] property inclusion is present", () => {
    // A frontmatter match has no folder/extension equivalent, so whitelisting only
    // "Research" would drop every [Topics:Physics] note living outside it.
    expect(getMiyoFolderInclusions("[Topics:Physics], Research")).toEqual({});
    expect(getMiyoFolderInclusions("[Subject:], *.md")).toEqual({});
  });

  it("drops root/parent pointers from include_folders", () => {
    expect(getMiyoFolderInclusions("./")).toEqual({});
    expect(getMiyoFolderInclusions("projects, .")).toEqual({ include_folders: ["projects"] });
  });
});

/** App whose vault reports the given name; enough for the receipt helpers. */
const appNamed = (name: string): App => ({ vault: { getName: () => name } }) as unknown as App;

/** Settings stub for the sync-receipt helpers. */
const receiptSettings = (over: Partial<CopilotSettings> = {}): CopilotSettings =>
  ({
    copilotFolder: "copilot",
    copilotRootHistory: ["copilot"],
    miyoServerUrl: "",
    qaInclusions: "",
    qaExclusions: "copilot",
    enableMiyo: false,
    miyoSyncedExclusions: "",
    ...over,
  }) as unknown as CopilotSettings;

describe("buildMiyoSyncReceipt", () => {
  it("binds device, url, folder, and the sorted system roots", () => {
    const receipt = JSON.parse(
      buildMiyoSyncReceipt(
        appNamed("my-vault"),
        receiptSettings({ copilotFolder: "team/ai", copilotRootHistory: ["zeta", "alpha"] })
      )
    ) as { device: string; url: string; folder: string; roots: string[] };
    expect(receipt.device).toBe("device-A");
    expect(receipt.url).toBe("");
    expect(receipt.folder).toBe("my-vault");
    expect(receipt.roots).toEqual([...receipt.roots].sort());
    expect(receipt.roots).toContain("team/ai");
  });

  it("yields the same receipt regardless of history order", () => {
    // Obsidian Sync can reorder copilotRootHistory on merge; content-equal
    // histories must not fake a mismatch.
    const a = buildMiyoSyncReceipt(
      appNamed("v"),
      receiptSettings({ copilotRootHistory: ["one", "two"] })
    );
    const b = buildMiyoSyncReceipt(
      appNamed("v"),
      receiptSettings({ copilotRootHistory: ["two", "one"] })
    );
    expect(a).toBe(b);
  });
});

describe("isMiyoScopeMismatch", () => {
  it("matches when the stored receipt equals the current expected receipt", () => {
    const app = appNamed("v");
    const settings = receiptSettings();
    const synced = receiptSettings({ miyoSyncedExclusions: buildMiyoSyncReceipt(app, settings) });
    expect(isMiyoScopeMismatch(app, synced)).toBe(false);
  });

  it("mismatches after the root changes", () => {
    const app = appNamed("v");
    const before = buildMiyoSyncReceipt(app, receiptSettings());
    const after = receiptSettings({
      copilotFolder: "team/ai",
      copilotRootHistory: ["copilot", "team/ai"],
      miyoSyncedExclusions: before,
    });
    expect(isMiyoScopeMismatch(app, after)).toBe(true);
  });

  it("mismatches when the receipt was written by another device", () => {
    const app = appNamed("v");
    const settings = receiptSettings();
    const foreign = buildMiyoSyncReceipt(app, settings).replace("device-A", "device-B");
    expect(isMiyoScopeMismatch(app, receiptSettings({ miyoSyncedExclusions: foreign }))).toBe(true);
  });

  it("treats a missing receipt field as mismatch", () => {
    const settings = receiptSettings();
    delete (settings as unknown as Record<string, unknown>).miyoSyncedExclusions;
    expect(isMiyoScopeMismatch(appNamed("v"), settings)).toBe(true);
  });
});

describe("shouldSurfaceMiyoResync", () => {
  it("surfaces for a mismatch while Miyo is enabled", () => {
    expect(shouldSurfaceMiyoResync(appNamed("v"), receiptSettings({ enableMiyo: true }))).toBe(
      true
    );
  });

  it("surfaces for a mismatch with a past registration even when Miyo is disabled", () => {
    // Disconnected in Copilot but still registered server-side: Relay can still
    // read, so the prompt must not disappear.
    const app = appNamed("v");
    const stale = buildMiyoSyncReceipt(app, receiptSettings()).replace("device-A", "device-B");
    expect(shouldSurfaceMiyoResync(app, receiptSettings({ miyoSyncedExclusions: stale }))).toBe(
      true
    );
  });

  it("stays quiet for a never-registered user", () => {
    expect(shouldSurfaceMiyoResync(appNamed("v"), receiptSettings())).toBe(false);
  });

  it("stays quiet when the receipt is current", () => {
    const app = appNamed("v");
    const settings = receiptSettings({ enableMiyo: true });
    const synced = receiptSettings({
      enableMiyo: true,
      miyoSyncedExclusions: buildMiyoSyncReceipt(app, settings),
    });
    expect(shouldSurfaceMiyoResync(app, synced)).toBe(false);
  });
});

describe("didMiyoSyncedRootsChange", () => {
  it("returns false with no receipt", () => {
    expect(didMiyoSyncedRootsChange(receiptSettings())).toBe(false);
  });

  it("returns true after the roots actually change", () => {
    const receipt = buildMiyoSyncReceipt(appNamed("v"), receiptSettings());
    const changed = receiptSettings({
      copilotFolder: "team/ai",
      copilotRootHistory: ["copilot", "team/ai"],
      miyoSyncedExclusions: receipt,
    });
    expect(didMiyoSyncedRootsChange(changed)).toBe(true);
  });

  it("returns false for a device-only mismatch (roots unchanged)", () => {
    // Another device's receipt with identical roots: the settings tab's on-load
    // verification self-heals this silently; no startup nag.
    const foreign = buildMiyoSyncReceipt(appNamed("v"), receiptSettings()).replace(
      "device-A",
      "device-B"
    );
    expect(didMiyoSyncedRootsChange(receiptSettings({ miyoSyncedExclusions: foreign }))).toBe(
      false
    );
  });

  it("returns false for a malformed receipt", () => {
    expect(didMiyoSyncedRootsChange(receiptSettings({ miyoSyncedExclusions: "not-json" }))).toBe(
      false
    );
  });
});

describe("hasUserQaPatterns", () => {
  it("returns false for the default exclusions (system root only)", () => {
    expect(hasUserQaPatterns(receiptSettings())).toBe(false);
  });

  it("returns false when exclusions hold only system roots, even with trailing slashes", () => {
    const settings = receiptSettings({
      copilotFolder: "team/ai",
      copilotRootHistory: ["copilot", "team/ai"],
      qaExclusions: encodeURIComponent("copilot/") + "," + encodeURIComponent("team/ai"),
    });
    expect(hasUserQaPatterns(settings)).toBe(false);
  });

  it("returns true when the user added their own exclusion", () => {
    expect(hasUserQaPatterns(receiptSettings({ qaExclusions: "copilot,journal" }))).toBe(true);
  });

  it("returns true when any inclusion is set", () => {
    expect(hasUserQaPatterns(receiptSettings({ qaInclusions: "projects" }))).toBe(true);
  });

  it("returns false when exclusions were cleared entirely", () => {
    expect(hasUserQaPatterns(receiptSettings({ qaExclusions: "" }))).toBe(false);
  });
});
