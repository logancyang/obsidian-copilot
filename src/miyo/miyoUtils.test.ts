// miyoUtils imports isMiyoAvailableForCapability (used by resolveDocProcessorBackend,
// which is covered end-to-end in FileParserManager.test.ts). Stub the status store
// so importing the module here doesn't pull in the real store.
jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));

import { Platform, type App } from "obsidian";
import type { CopilotSettings } from "@/settings/model";
import {
  getMiyoFilePath,
  getMiyoFolderName,
  getSearchBackend,
  getVaultRelativeMiyoPath,
  isCurrentVaultMiyoPath,
  isLocalMiyoUrl,
  seedDocProcessorBackend,
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
